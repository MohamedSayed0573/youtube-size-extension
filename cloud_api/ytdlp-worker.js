/**
 * Worker Thread for yt-dlp Execution
 *
 * This worker handles yt-dlp subprocess execution in a separate thread to prevent
 * blocking the main Node.js event loop. It receives messages via parentPort with
 * URL and configuration, executes yt-dlp, and returns the result.
 *
 * Key Features:
 * - Runs in isolated Worker thread (no event loop blocking)
 * - Executes yt-dlp as child process with timeout protection
 * - Returns JSON metadata or error message
 * - Automatic cleanup on completion
 * - Defense-in-depth URL validation before execution
 *
 * Message Protocol:
 * Input: { url: string, timeout: number, maxBuffer: number, retryAttempt: number, cookies?: string }
 * Output: { success: true, data: Object } | { success: false, error: string, code?: string }
 * @file Worker thread for non-blocking yt-dlp execution
 * @author YouTube Size Extension Team
 * @version 2.0.0
 */

const { parentPort } = require("worker_threads");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isValidYouTubeUrl } = require("./utils/ytdlp");

const execFileAsync = promisify(execFile);
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

/**
 * Execute yt-dlp with given parameters
 * @param {string} url - YouTube video URL (will be validated before execution)
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} maxBuffer - Maximum buffer size for stdout/stderr
 * @param {number} retryAttempt - Current retry attempt number (for logging)
 * @param {string|null} cookies - Optional cookies in Netscape format for authentication
 * @returns {Promise<Object>} Result object with success flag and data/error
 */
async function executeYtdlp(
    url,
    timeout,
    maxBuffer,
    retryAttempt,
    cookies = null
) {
    let cookiesPath = null;

    // Defense-in-depth: Validate URL even though main thread should have validated
    if (!isValidYouTubeUrl(url)) {
        return {
            success: false,
            error: "Invalid or unsafe YouTube URL",
            code: "INVALID_URL",
        };
    }

    try {
        // Write cookies to temp file if provided
        if (cookies && typeof cookies === "string" && cookies.length > 0) {
            // Generate unique filename to avoid race conditions
            const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            cookiesPath = path.join(os.tmpdir(), `yt-cookies-${uniqueId}.txt`);
            await writeFileAsync(cookiesPath, cookies, { mode: 0o600 });
        }

        const args = [
            "-J",
            "--skip-download",
            "--no-playlist",
            "--js-runtimes",
            "node",
        ];

        // Add cookies flag if we have a cookies file
        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }

        // Add URL last (after -- to prevent URL from being parsed as option)
        args.push("--", url);

        // Debug: log the full command for troubleshooting
        console.log(
            `[Worker] Executing: yt-dlp ${args.join(" ")} (cookies: ${cookiesPath ? "yes" : "no"})`
        );

        const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
            timeout,
            maxBuffer,
            windowsHide: true,
        });

        // Log warnings but continue
        if (stderr) {
            console.warn(
                `[Worker] yt-dlp stderr (attempt ${retryAttempt}):`,
                stderr
            );
        }

        const data = JSON.parse(stdout);
        return { success: true, data };
    } catch (error) {
        // Classify error types for circuit breaker
        let errorCode = "UNKNOWN";
        let errorMessage = error.message || "Unknown error occurred";

        // Safely access error properties with fallbacks
        const stderr = typeof error.stderr === "string" ? error.stderr : "";
        const errorCodeFromError = error.code || null;

        if (error.killed || error.signal === "SIGTERM") {
            errorCode = "TIMEOUT";
            errorMessage = "yt-dlp timed out";
        } else if (errorCodeFromError === "ENOENT") {
            errorCode = "NOT_FOUND";
            errorMessage = "yt-dlp executable not found";
        } else if (errorCodeFromError === "ECONNREFUSED") {
            errorCode = "NETWORK_ERROR";
            errorMessage = "Connection refused";
        } else if (errorCodeFromError === "ECONNRESET") {
            errorCode = "NETWORK_ERROR";
            errorMessage = "Connection reset";
        } else if (errorCodeFromError === "ETIMEDOUT") {
            errorCode = "TIMEOUT";
            errorMessage = "Connection timed out";
        } else if (stderr.includes("Video unavailable")) {
            errorCode = "VIDEO_UNAVAILABLE";
            errorMessage = "Video is unavailable or private";
        } else if (stderr.includes("Private video")) {
            errorCode = "VIDEO_UNAVAILABLE";
            errorMessage = "Video is private";
        } else if (stderr.includes("This video is not available")) {
            errorCode = "VIDEO_UNAVAILABLE";
            errorMessage = "Video is not available in your region";
        } else if (
            stderr.includes("HTTP Error 429") ||
            stderr.includes("Too Many Requests")
        ) {
            errorCode = "RATE_LIMITED";
            errorMessage = "YouTube rate limit exceeded";
        } else if (
            stderr.includes("network") ||
            stderr.includes("Unable to download") ||
            stderr.includes("Connection")
        ) {
            errorCode = "NETWORK_ERROR";
            errorMessage = "Network error occurred";
        } else if (stderr.includes("Sign in to confirm your age")) {
            errorCode = "VIDEO_UNAVAILABLE";
            errorMessage = "Video requires age verification";
        }

        return {
            success: false,
            error: errorMessage,
            code: errorCode,
            stderr: stderr || undefined,
        };
    } finally {
        // Clean up temp cookies file
        if (cookiesPath) {
            try {
                await unlinkAsync(cookiesPath);
            } catch (cleanupError) {
                // Ignore cleanup errors - file may already be deleted or not exist
                console.warn(
                    `[Worker] Failed to cleanup cookies file: ${cleanupError.message}`
                );
            }
        }
    }
}

// Listen for messages from main thread
if (parentPort) {
    parentPort.on("message", async (task) => {
        // Handle warm-up ping
        if (task && task.warmUp === true) {
            parentPort.postMessage({ warmUp: true });
            return;
        }

        const {
            url,
            timeout,
            maxBuffer,
            retryAttempt = 0,
            cookies = null,
        } = task;

        const result = await executeYtdlp(
            url,
            timeout,
            maxBuffer,
            retryAttempt,
            cookies
        );
        parentPort.postMessage(result);
    });
}

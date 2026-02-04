/**
 * Utility functions for video size extraction
 * @module utils/ytdlp
 */

const Sentry = require("@sentry/node");
const { VIDEO_FORMAT_IDS, AUDIO_FALLBACK_ID } = require("../config/constants");

/**
 * Validates that a URL is a legitimate YouTube URL
 *
 * Prevents command injection by ensuring only valid YouTube URLs are processed.
 * Blocks any URL with shell metacharacters or suspicious patterns.
 * @param {string} url - The URL to validate
 * @returns {boolean} True if URL is valid and safe
 */
function isValidYouTubeUrl(url) {
    if (!url || typeof url !== "string") {
        return false;
    }

    // Check length (YouTube URLs shouldn't be extremely long)
    if (url.length > 200) {
        return false;
    }

    // Block shell metacharacters and command injection patterns
    const dangerousPatterns = [
        /[;&|`$(){}[\]<>\\]/, // Shell metacharacters (no need to escape [ ] inside character class)
        /\$\(/, // Command substitution
        /`/, // Backtick execution
        /\.\.\//, // Path traversal
        /file:\/\//, // File protocol
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(url)) {
            return false;
        }
    }

    // Validate it's actually a YouTube URL
    try {
        const parsedUrl = new URL(url);
        const validHosts = [
            "www.youtube.com",
            "youtube.com",
            "m.youtube.com",
            "youtu.be",
        ];

        if (!validHosts.includes(parsedUrl.hostname)) {
            return false;
        }

        // Must use https protocol
        if (parsedUrl.protocol !== "https:") {
            return false;
        }

        // Validate has video ID or is a valid path
        const hasVideoParam = parsedUrl.searchParams.has("v");
        const isValidPath =
            parsedUrl.pathname.startsWith("/watch") ||
            parsedUrl.pathname.match(/^\/shorts\/[\w-]+$/) ||
            parsedUrl.hostname === "youtu.be";

        return hasVideoParam || isValidPath;
    } catch (error) {
        return false;
    }
}

/**
 * Converts bytes to human-readable format using decimal (SI) units
 * @param {number} n - Number of bytes
 * @returns {string|null} Formatted string (e.g., "45.32 MB") or null if invalid
 */
function humanizeBytes(n) {
    if (!n || n <= 0) return null;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
        v /= 1000;
        i++;
    }
    return i === 0
        ? `${Math.round(v)} ${units[i]}`
        : `${v.toFixed(2)} ${units[i]}`;
}

/**
 * Converts seconds to H:MM:SS or M:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string|null} Formatted duration string or null if invalid
 */
function humanizeDuration(seconds) {
    if (!seconds || seconds <= 0) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Formats uptime in human-readable format
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(" ");
}

/**
 * Calculates file size from a yt-dlp format object
 *
 * Prefers exact filesize, falls back to filesize_approx, then estimates
 * from bitrate (tbr) and duration.
 * @param {Object} fmt - The format object from yt-dlp JSON output
 * @param {number} durationSec - Video duration in seconds
 * @returns {number|null} Estimated size in bytes or null
 */
function sizeFromFormat(fmt, durationSec) {
    if (!fmt) return null;

    // Pick first non-null, positive value
    const fs =
        (fmt.filesize != null && fmt.filesize > 0 ? fmt.filesize : null) ||
        (fmt.filesize_approx != null && fmt.filesize_approx > 0
            ? fmt.filesize_approx
            : null);
    if (fs) return Math.round(fs);

    // Estimate from TBR if filesize missing
    try {
        const tbr = fmt.tbr; // in kbps
        if (tbr && durationSec && durationSec > 0) {
            return Math.round(((tbr * 1000.0) / 8.0) * durationSec);
        }
    } catch (e) {
        // ignore
    }
    return null;
}

/**
 * Extracts video metadata from YouTube using yt-dlp with retry logic
 *
 * Uses worker pool and circuit breaker for non-blocking execution
 * and fault tolerance.
 * @async
 * @param {string} url - The YouTube video URL (must be validated first)
 * @param {Object} workerPool - Worker pool instance
 * @param {Object} circuitBreaker - Circuit breaker instance
 * @param {Object} config - Configuration object
 * @param {Object} logger - Logger instance
 * @param {number} [maxRetries] - Maximum number of retry attempts
 * @param {string|null} [cookies] - Optional cookies in Netscape format for authentication
 * @returns {Promise<Object>} Parsed JSON metadata from yt-dlp
 * @throws {Error} If yt-dlp fails after all retries or circuit is open
 */
async function extractInfo(
    url,
    workerPool,
    circuitBreaker,
    config,
    logger,
    maxRetries = 2,
    cookies = null
) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Execute through circuit breaker with worker pool
            const data = await circuitBreaker.execute(async () => {
                return await workerPool.execute({
                    url,
                    timeout: config.YTDLP_TIMEOUT,
                    maxBuffer: config.YTDLP_MAX_BUFFER,
                    retryAttempt: attempt,
                    cookies, // Pass cookies for YouTube authentication
                });
            });

            return data;
        } catch (error) {
            lastError = error;

            // Don't retry if circuit is open
            if (error.code === "CIRCUIT_OPEN") {
                throw error;
            }

            // Don't retry on timeout or critical errors
            const noRetryErrors = ["TIMEOUT", "NOT_FOUND", "VIDEO_UNAVAILABLE"];
            if (noRetryErrors.includes(error.code)) {
                break;
            }

            // Don't retry on final attempt
            if (attempt < maxRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
                logger.warn(
                    {
                        attempt,
                        backoffMs,
                        error: error.message,
                        code: error.code,
                    },
                    "Retrying yt-dlp after failure"
                );
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }
    }

    // All retries exhausted - format error message
    logger.error(
        {
            url,
            attempts: maxRetries + 1,
            lastError: lastError.message,
            code: lastError.code,
        },
        "All retry attempts exhausted for video extraction"
    );

    Sentry.captureException(lastError, {
        tags: {
            component: "yt-dlp",
            errorType: lastError.code || "UNKNOWN",
        },
        contexts: {
            extraction: {
                url,
                attempts: maxRetries + 1,
            },
        },
    });

    if (lastError.code === "TIMEOUT") {
        throw new Error("yt-dlp timed out while fetching metadata");
    }
    if (lastError.code === "NOT_FOUND") {
        throw new Error("yt-dlp executable not found. Please install yt-dlp.");
    }
    if (lastError.code === "CIRCUIT_OPEN") {
        throw new Error(
            "Service temporarily unavailable. yt-dlp is experiencing issues."
        );
    }
    throw new Error(
        `Failed to fetch metadata after ${maxRetries + 1} attempts: ${lastError.message}`
    );
}

/**
 * Computes video sizes for all resolutions from yt-dlp metadata
 * Uses single-pass iteration for efficiency
 * @param {Object} meta - The complete metadata object from yt-dlp
 * @param {number} [durationHint] - Optional duration hint in seconds
 * @returns {Object} Result object with ok, bytes, human, and duration fields
 * @throws {Error} If no size information could be determined
 */
function computeSizes(meta, durationHint) {
    const formats = meta.formats || [];

    let durationSec = null;
    try {
        const dur = meta.duration;
        if (typeof dur === "number") {
            durationSec = Math.round(dur);
        }
    } catch (e) {
        // ignore
    }

    if (!durationSec && typeof durationHint === "number" && durationHint > 0) {
        durationSec = Math.round(durationHint);
    }

    // Build a set of all format IDs we care about (single iteration to build index)
    const targetFormatIds = new Set();
    for (const ids of Object.values(VIDEO_FORMAT_IDS)) {
        for (const id of ids) {
            targetFormatIds.add(id);
        }
    }
    // Add specific codec variants
    targetFormatIds.add("299"); // 1080p H.264
    targetFormatIds.add("303"); // 1080p VP9
    targetFormatIds.add("399"); // 1080p AV1
    targetFormatIds.add("308"); // 1440p VP9
    targetFormatIds.add("400"); // 1440p AV1
    targetFormatIds.add(AUDIO_FALLBACK_ID);

    // Single pass: build format size map for only the IDs we care about
    const formatSizes = new Map();
    for (const f of formats) {
        const fid = f.format_id != null ? String(f.format_id) : null;
        if (fid && targetFormatIds.has(fid)) {
            const size = sizeFromFormat(f, durationSec);
            if (size) {
                formatSizes.set(fid, size);
            }
        }
    }

    // Audio size (already computed in single pass)
    const audioSize = formatSizes.get(AUDIO_FALLBACK_ID) || null;

    // Initialize output
    const bytesOut = {
        s144p: null,
        s240p: null,
        s360p: null,
        s480p: null,
        s720p: null,
        s1080p: null,
        s1440p: null,
        s1080p_299: null,
        s1080p_303: null,
        s1080p_399: null,
        s1440p_308: null,
        s1440p_400: null,
    };

    // For each resolution, pick a candidate video id (use pre-computed sizes)
    for (const [label, ids] of Object.entries(VIDEO_FORMAT_IDS)) {
        let vidSize = null;

        for (const fid of ids) {
            const sz = formatSizes.get(fid);
            if (sz) {
                vidSize = sz;
                break;
            }
        }

        if (vidSize) {
            const key = `s${label}`;
            bytesOut[key] = audioSize ? vidSize + audioSize : vidSize;
        }
    }

    // Expose specific codec variants for 1080p and 1440p (use pre-computed sizes)
    const codecVariants = [
        ["1080p", ["299", "303", "399"]],
        ["1440p", ["308", "400"]],
    ];

    for (const [res, fids] of codecVariants) {
        for (const fid of fids) {
            const sz = formatSizes.get(fid);
            if (sz) {
                bytesOut[`s${res}_${fid}`] = audioSize ? sz + audioSize : sz;
            }
        }
    }

    // Convert to human-readable
    const humanOut = {};
    for (const [k, v] of Object.entries(bytesOut)) {
        humanOut[k] = humanizeBytes(v);
    }
    humanOut.duration = humanizeDuration(durationSec);

    // Check if we got any sizes
    const hasAny = Object.values(bytesOut).some((v) => v != null);
    if (!hasAny) {
        throw new Error(
            "No size information could be determined from yt-dlp output"
        );
    }

    return {
        ok: true,
        bytes: bytesOut,
        human: humanOut,
        duration: durationSec,
    };
}

module.exports = {
    isValidYouTubeUrl,
    humanizeBytes,
    humanizeDuration,
    formatUptime,
    sizeFromFormat,
    extractInfo,
    computeSizes,
};

/**
 * Cloud API Server for YouTube Size Extension
 *
 * This Node.js/Express server provides an HTTP API for fetching YouTube video
 * size information using yt-dlp. It serves as an alternative to the native
 * messaging host, allowing users to deploy the service on a cloud platform.
 *
 * Key features:
 * - RESTful API endpoint for size extraction
 * - Supports duration hints to optimize yt-dlp calls
 * - Extracts multiple resolutions (144p-1440p)
 * - Handles multiple codec variants (H.264, VP9, AV1)
 * - CORS enabled for browser extension requests
 * - Timeout protection (25 seconds)
 * - Comprehensive error handling
 *
 * Endpoint:
 *   POST /size
 *   Body: { url: string, duration_hint?: number }
 *   Response: { ok: boolean, bytes: Object, human: Object, duration: number }
 *
 * @fileoverview Cloud API server for yt-dlp size extraction
 * @author YouTube Size Extension Team
 * @version 2.0.0
 */

require("./instrument");
const Sentry = require("@sentry/node");
const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { promisify } = require("util");
const rateLimit = require("express-rate-limit");
const os = require("os");
const { z } = require("zod");
const pino = require("pino");

const execFileAsync = promisify(execFile);

// Initialize logger
const logger = pino({
    level:
        process.env.LOG_LEVEL ||
        (process.env.NODE_ENV === "test" ? "silent" : "info"),
    transport:
        process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
            ? {
                  target: "pino-pretty",
                  options: {
                      colorize: true,
                      translateTime: "SYS:standard",
                      ignore: "pid,hostname",
                  },
              }
            : undefined,
});

// ============================================
// Environment Configuration with Zod Validation
// ============================================

const envSchema = z
    .object({
        // Server configuration
        PORT: z.string().default("3000").transform(Number),
        NODE_ENV: z
            .enum(["development", "staging", "production", "test"])
            .default("development"),

        // Authentication
        API_KEY: z.string().optional().default(""),
        REQUIRE_AUTH: z
            .string()
            .transform((val) => val === "true")
            .default("false"),

        // CORS configuration
        ALLOWED_ORIGINS: z.string().optional().default("*"),

        // Rate limiting
        RATE_LIMIT_WINDOW_MS: z.string().default("60000").transform(Number),
        RATE_LIMIT_MAX_REQUESTS: z.string().default("20").transform(Number),

        // yt-dlp configuration
        YTDLP_TIMEOUT: z.string().default("25000").transform(Number),
        YTDLP_MAX_BUFFER: z.string().default("10485760").transform(Number),
    })
    .refine((data) => !data.REQUIRE_AUTH || data.API_KEY !== "", {
        message: "API_KEY must be set when REQUIRE_AUTH is true",
        path: ["API_KEY"],
    });

// Validate and parse environment variables
let CONFIG;
try {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
        logger.error(
            { errors: parsed.error.issues },
            "Environment configuration validation failed"
        );
        parsed.error.issues.forEach((issue) => {
            logger.error(
                { path: issue.path.join("."), message: issue.message },
                "Validation error"
            );
        });
        process.exit(1);
    }

    CONFIG = {
        ...parsed.data,
        API_VERSION: "v1",
        ALLOWED_ORIGINS:
            parsed.data.ALLOWED_ORIGINS === "*"
                ? "*"
                : parsed.data.ALLOWED_ORIGINS.split(",").map((s) => s.trim()),
    };

    logger.info(
        { config: CONFIG },
        "Environment configuration validated successfully"
    );
} catch (error) {
    logger.error(
        { error: error.message },
        "Failed to parse environment configuration"
    );
    process.exit(1);
}

const app = express();

// ============================================
// Middleware Configuration
// ============================================

/**
 * Request ID middleware for distributed tracing
 * Generates or extracts correlation ID for tracking requests across services
 */
app.use((req, res, next) => {
    // Check for existing request ID from proxy/load balancer
    const requestId = req.headers['x-request-id'] || 
                     req.headers['x-correlation-id'] || 
                     `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    
    // Add to logger context
    req.log = logger.child({ requestId });
    
    next();
});

// Enable CORS with restrictions (configure for production)
const corsOptions = {
    origin: CONFIG.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: "10kb" })); // Limit request body size

// Rate limiting configuration
const apiLimiter = rateLimit({
    windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
    message: {
        ok: false,
        error: "Too many requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => CONFIG.NODE_ENV === "development" && !CONFIG.REQUIRE_AUTH,
});

// Map of interesting format ids by resolution
const VIDEO_FORMAT_IDS = {
    "144p": ["394"],
    "240p": ["395"],
    "360p": ["396"],
    "480p": ["397"],
    "720p": ["398"],
    "1080p": ["399", "299", "303"],
    "1440p": ["400", "308"],
};
/**
 * Middleware to verify API key authentication
 *
 * Checks X-API-Key header against configured API_KEY environment variable.
 * Skips authentication if REQUIRE_AUTH is false (development mode).
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
function authenticateApiKey(req, res, next) {
    // Skip auth if not required (development)
    if (!CONFIG.REQUIRE_AUTH) {
        return next();
    }

    const apiKey = req.headers["x-api-key"];

    if (!apiKey || apiKey !== CONFIG.API_KEY) {
        return res.status(401).json({
            ok: false,
            error: "Unauthorized. Valid API key required.",
        });
    }

    next();
}

const AUDIO_FALLBACK_ID = "251";

/**
 * Validates that a URL is a legitimate YouTube URL
 *
 * Prevents command injection by ensuring only valid YouTube URLs are processed.
 * Blocks any URL with shell metacharacters or suspicious patterns.
 *
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
        /[;&|`$(){}\[\]<>\\]/, // Shell metacharacters
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
 *
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
 *
 * @param {number} seconds - Duration in seconds
 * @returns {string|null} Formatted duration string or null if invalid
 */
function humanizeDuration(seconds) {
    if (!seconds || seconds <= 0) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0)
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Calculates file size from a yt-dlp format object
 *
 * Prefers exact filesize, falls back to filesize_approx, then estimates
 * from bitrate (tbr) and duration.
 *
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
 * Runs yt-dlp with -J flag to get complete metadata in JSON format.
 * Uses execFile() instead of exec() to prevent command injection.
 * Includes timeout protection, error handling, and exponential backoff retry.
 *
 * @async
 * @param {string} url - The YouTube video URL (must be validated first)
 * @param {number} [maxRetries=2] - Maximum number of retry attempts
 * @returns {Promise<Object>} Parsed JSON metadata from yt-dlp
 * @throws {Error} If yt-dlp fails after all retries or times out
 */
async function extractInfo(url, maxRetries = 2) {
    // Use yt-dlp to extract metadata in JSON format
    // Using execFile instead of exec prevents command injection
    const args = ["-J", "--skip-download", "--no-playlist", url];

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
                timeout: CONFIG.YTDLP_TIMEOUT,
                maxBuffer: CONFIG.YTDLP_MAX_BUFFER,
                windowsHide: true, // Hide console window on Windows
            });

            if (stderr) {
                logger.warn({ stderr, attempt }, "yt-dlp warnings");
            }

            return JSON.parse(stdout);
        } catch (error) {
            lastError = error;
            
            // Don't retry on timeout or client errors
            if (error.killed || error.code === 'ENOENT') {
                break;
            }
            
            // Don't retry on final attempt
            if (attempt < maxRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
                logger.warn(
                    { attempt, backoffMs, error: error.message },
                    "Retrying yt-dlp after failure"
                );
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }
    }

    // All retries exhausted
    if (lastError.killed) {
        throw new Error("yt-dlp timed out while fetching metadata");
    }
    if (lastError.code === 'ENOENT') {
        throw new Error("yt-dlp executable not found. Please install yt-dlp.");
    }
    throw new Error(`Failed to fetch metadata after ${maxRetries + 1} attempts: ${lastError.message}`);
}

/**
 * Computes video sizes for all resolutions from yt-dlp metadata
 *
 * Analyzes the formats array from yt-dlp JSON output to calculate
 * combined sizes (video + audio) for each resolution tier.
 *
 * Handles:
 * - Multiple codec variants (H.264/VP9/AV1 for 1080p/1440p)
 * - Audio track combination (typically format 251)
 * - Duration fallback to hint if metadata missing
 *
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

    // Build index of formats by itag/id
    const byId = {};
    for (const f of formats) {
        const fid = f.format_id != null ? String(f.format_id) : null;
        if (fid) {
            byId[fid] = f;
        }
    }

    // Audio size
    const audioSize = sizeFromFormat(byId[AUDIO_FALLBACK_ID], durationSec);

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

    // For each resolution, pick a candidate video id and compute combined size with audio
    for (const [label, ids] of Object.entries(VIDEO_FORMAT_IDS)) {
        let vidSize = null;
        let chosenId = null;

        for (const fid of ids) {
            const sz = sizeFromFormat(byId[fid], durationSec);
            if (sz) {
                vidSize = sz;
                chosenId = fid;
                break;
            }
        }

        if (chosenId && vidSize) {
            const key = `s${label}`;
            bytesOut[key] =
                audioSize && label.includes("p")
                    ? vidSize + audioSize
                    : vidSize;

            // Expose specific combos for 1080p and 1440p
            if (label === "1080p") {
                for (const fid of ["299", "303", "399"]) {
                    const sz = sizeFromFormat(byId[fid], durationSec);
                    if (sz) {
                        bytesOut[`s1080p_${fid}`] = audioSize
                            ? sz + audioSize
                            : sz;
                    }
                }
            }
            if (label === "1440p") {
                for (const fid of ["308", "400"]) {
                    const sz = sizeFromFormat(byId[fid], durationSec);
                    if (sz) {
                        bytesOut[`s1440p_${fid}`] = audioSize
                            ? sz + audioSize
                            : sz;
                    }
                }
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

// ============================================
// API Versioning & Health Endpoints
// ============================================

// Root endpoint
app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "ytdlp-sizer-api",
        version: CONFIG.API_VERSION,
        status: "running",
        documentation: "/api/v1/docs",
    });
});

/**
 * Health check endpoint
 * Returns comprehensive system metrics, yt-dlp status, and service info
 */
app.get("/health", apiLimiter, async (req, res) => {
    try {
        // Check yt-dlp availability and version
        let ytdlpVersion = "unknown";
        let ytdlpAvailable = false;
        try {
            const { stdout } = await execFileAsync("yt-dlp", ["--version"], {
                timeout: 5000,
            });
            ytdlpVersion = stdout.trim();
            ytdlpAvailable = true;
        } catch (error) {
            logger.warn({ error: error.message }, "yt-dlp not available");
        }

        // System metrics
        const uptime = Math.floor(process.uptime());
        const memUsage = process.memoryUsage();

        res.json({
            ok: true,
            status: ytdlpAvailable ? "healthy" : "degraded",
            timestamp: new Date().toISOString(),
            version: CONFIG.API_VERSION,
            uptime: {
                seconds: uptime,
                formatted: formatUptime(uptime),
            },
            system: {
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version,
                cpus: os.cpus().length,
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    used: os.totalmem() - os.freemem(),
                    usagePercent: (
                        (1 - os.freemem() / os.totalmem()) *
                        100
                    ).toFixed(2),
                },
                loadAverage: os.loadavg(),
            },
            process: {
                pid: process.pid,
                memory: {
                    rss: memUsage.rss,
                    heapTotal: memUsage.heapTotal,
                    heapUsed: memUsage.heapUsed,
                    external: memUsage.external,
                },
                uptime: process.uptime(),
            },
            dependencies: {
                ytdlp: {
                    available: ytdlpAvailable,
                    version: ytdlpVersion,
                },
            },
            config: {
                environment: CONFIG.NODE_ENV,
                authEnabled: CONFIG.REQUIRE_AUTH,
                corsOrigins:
                    CONFIG.ALLOWED_ORIGINS === "*"
                        ? "all"
                        : CONFIG.ALLOWED_ORIGINS.length,
                rateLimit: {
                    windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
                    maxRequests: CONFIG.RATE_LIMIT_MAX_REQUESTS,
                },
            },
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            status: "unhealthy",
            error: error.message,
        });
    }
});

/**
 * API documentation endpoint
 */
app.get("/api/v1/docs", (req, res) => {
    res.json({
        version: CONFIG.API_VERSION,
        service: "ytdlp-sizer-api",
        description: "API for extracting YouTube video size information",
        endpoints: {
            health: {
                "GET /": "Root endpoint with basic info",
                "GET /health": "Health check with system metrics",
            },
            api: {
                "POST /api/v1/size": "Extract video size information",
            },
        },
        authentication: CONFIG.REQUIRE_AUTH
            ? "Required: X-API-Key header"
            : "Optional",
        rateLimit: `${CONFIG.RATE_LIMIT_MAX_REQUESTS} requests per ${CONFIG.RATE_LIMIT_WINDOW_MS / 1000} seconds`,
        features: {
            requestTracing: "X-Request-ID header for distributed tracing",
            retryLogic: "Automatic retry with exponential backoff (up to 2 retries)",
            cacheStrategy: "Client-side caching recommended (extension handles TTL)",
        },
    });
});

// ============================================
// API v1 Endpoints
// ============================================

// Main size extraction endpoint (v1)
app.post("/api/v1/size", apiLimiter, authenticateApiKey, async (req, res) => {
    const startTime = Date.now();
    try {
        const { url, duration_hint } = req.body;

        // Add Sentry breadcrumb for tracking
        Sentry.addBreadcrumb({
            category: "api",
            message: "Video size request received",
            data: { url, duration_hint, requestId: req.requestId },
            level: "info",
        });

        req.log.info({ url, duration_hint }, "Processing size request");

        // Validate URL is provided
        if (!url) {
            req.log.warn("Request missing URL parameter");
            return res
                .status(400)
                .json({ ok: false, error: "URL is required", requestId: req.requestId });
        }

        // Validate URL is safe and is a YouTube URL
        if (!isValidYouTubeUrl(url)) {
            req.log.warn({ url }, "Invalid or unsafe YouTube URL");
            return res.status(400).json({
                ok: false,
                error: "Invalid or unsafe YouTube URL",
                requestId: req.requestId,
            });
        }

        // Validate duration_hint if provided
        if (
            duration_hint !== undefined &&
            (typeof duration_hint !== "number" ||
                !isFinite(duration_hint) ||
                duration_hint < 0 ||
                duration_hint > 86400)
        ) {
            req.log.warn({ duration_hint }, "Invalid duration_hint");
            return res.status(400).json({
                ok: false,
                error: "Invalid duration_hint (must be 0-86400 seconds)",
                requestId: req.requestId,
            });
        }

        // Extract metadata using yt-dlp (with retries)
        const meta = await extractInfo(url);

        // Compute sizes
        const result = computeSizes(meta, duration_hint);

        const duration = Date.now() - startTime;
        req.log.info({ duration, videoId: meta.id }, "Request completed successfully");

        res.json(result);
    } catch (error) {
        const duration = Date.now() - startTime;
        Sentry.captureException(error, {
            contexts: {
                request: {
                    requestId: req.requestId,
                    url: req.body.url,
                    duration,
                },
            },
        });
        req.log.error(
            { error: error.message, url: req.body.url, duration },
            "Error processing request"
        );
        
        // Determine appropriate status code
        let statusCode = 502;
        if (error.message.includes("timed out")) {
            statusCode = 504;
        } else if (error.message.includes("not found")) {
            statusCode = 503;
        }
        
        res.status(statusCode).json({
            ok: false,
            error: error.message,
            requestId: req.requestId,
        });
    }
});

// ============================================
// Utility Functions
// ============================================

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

// ============================================
// Error Handlers
// ============================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        ok: false,
        error: "Endpoint not found",
        availableEndpoints: ["/", "/health", "/api/v1/size", "/api/v1/docs"],
    });
});

// Sentry error handler - must be after all routes but before custom error handlers
// This automatically captures all errors and sends them to Sentry
Sentry.setupExpressErrorHandler(app);

// Global error handler
app.use((err, req, res, next) => {
    // Error already captured by Sentry middleware above
    logger.error(
        { err, path: req.path, method: req.method },
        "Unhandled error"
    );
    res.status(500).json({
        ok: false,
        error: "Internal server error",
    });
});

// ============================================
// Server Startup
// ============================================

// Export app for testing
if (typeof module !== "undefined" && module.exports) {
    module.exports = app;
}

// Only start server if not in test mode
if (CONFIG.NODE_ENV !== "test") {
    app.listen(CONFIG.PORT, "0.0.0.0", () => {
        logger.info(
            {
                service: "ytdlp-sizer-api",
                version: CONFIG.API_VERSION,
                port: CONFIG.PORT,
                environment: CONFIG.NODE_ENV,
                authRequired: CONFIG.REQUIRE_AUTH,
                rateLimit: `${CONFIG.RATE_LIMIT_MAX_REQUESTS}/min`,
                endpoints: ["/", "/health", "/api/v1/size", "/api/v1/docs"],
            },
            "Server started successfully"
        );
    });
}

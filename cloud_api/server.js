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
const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis");
const redis = require("redis");
const os = require("os");
const { z } = require("zod");
const pino = require("pino");
const WorkerPool = require("./worker-pool");
const { CircuitBreaker } = require("./circuit-breaker");

// ============================================
// Constants
// ============================================

const TIMEOUTS = {
    YTDLP_DEFAULT: 25000, // 25 seconds for yt-dlp execution
    TASK_BUFFER: 5000, // 5 second buffer for worker tasks
    HEALTH_CHECK: 5000, // 5 seconds for health check
    WORKER_IDLE: 120000, // 2 minutes worker idle timeout
    CIRCUIT_COOLDOWN: 60000, // 1 minute circuit breaker cooldown
    SHUTDOWN_GRACE: 10000, // 10 seconds graceful shutdown
};

const LIMITS = {
    MAX_BUFFER: 10 * 1024 * 1024, // 10 MB max buffer for yt-dlp output
    REQUEST_BODY: "10kb", // 10 KB max request body
    MIN_WORKERS: 2, // Minimum worker pool size
    MAX_WORKERS: 10, // Maximum worker pool size
    MAX_TASKS_PER_WORKER: 100, // Tasks before worker recycle
    CIRCUIT_FAILURE_THRESHOLD: 5, // Failures before circuit opens
    CIRCUIT_SUCCESS_THRESHOLD: 2, // Successes to close circuit
    CIRCUIT_VOLUME_THRESHOLD: 10, // Min requests before evaluation
};

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

        // Redis configuration (for distributed rate limiting)
        REDIS_URL: z.string().optional().default(""),
        REDIS_ENABLED: z
            .string()
            .transform((val) => val === "true")
            .default("false"),

        // yt-dlp configuration
        YTDLP_TIMEOUT: z
            .string()
            .default(String(TIMEOUTS.YTDLP_DEFAULT))
            .transform(Number),
        YTDLP_MAX_BUFFER: z
            .string()
            .default(String(LIMITS.MAX_BUFFER))
            .transform(Number),
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

    CONFIG = Object.freeze({
        ...parsed.data,
        API_VERSION: "v1",
        ALLOWED_ORIGINS:
            parsed.data.ALLOWED_ORIGINS === "*"
                ? "*"
                : parsed.data.ALLOWED_ORIGINS.split(",").map((s) => s.trim()),
    });

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
// Redis Client Setup (for distributed rate limiting)
// ============================================

let redisClient = null;
let redisReady = false;

if (CONFIG.REDIS_ENABLED && CONFIG.REDIS_URL) {
    redisClient = redis.createClient({
        url: CONFIG.REDIS_URL,
        socket: {
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    logger.error("Redis reconnect failed after 10 attempts");
                    return new Error("Redis reconnect failed");
                }
                const delay = Math.min(retries * 100, 3000);
                logger.info({ retries, delay }, "Redis reconnecting");
                return delay;
            },
        },
    });

    redisClient.on("error", (err) => {
        logger.error({ error: err.message }, "Redis client error");
        redisReady = false;
        Sentry.captureException(err, {
            tags: { component: "redis" },
        });
    });

    redisClient.on("connect", () => {
        logger.info("Redis client connecting");
    });

    redisClient.on("ready", () => {
        logger.info("Redis client ready");
        redisReady = true;
    });

    redisClient.on("reconnecting", () => {
        logger.warn("Redis client reconnecting");
        redisReady = false;
    });

    redisClient.on("end", () => {
        logger.info("Redis client disconnected");
        redisReady = false;
    });

    // Connect to Redis
    redisClient
        .connect()
        .then(() => {
            logger.info(
                { url: CONFIG.REDIS_URL },
                "Redis connection established"
            );
        })
        .catch((err) => {
            logger.error(
                { error: err.message },
                "Failed to connect to Redis - falling back to memory store"
            );
            Sentry.captureException(err, {
                tags: { component: "redis", severity: "warning" },
            });
        });
} else {
    logger.info(
        "Redis not enabled - using in-memory rate limiting (not recommended for production with multiple instances)"
    );
}

// ============================================
// Worker Pool & Circuit Breaker Setup
// ============================================

// Initialize worker pool for non-blocking yt-dlp execution
const workerPool = new WorkerPool({
    minWorkers: parseInt(
        process.env.MIN_WORKERS || String(LIMITS.MIN_WORKERS),
        10
    ),
    maxWorkers: parseInt(
        process.env.MAX_WORKERS || String(LIMITS.MAX_WORKERS),
        10
    ),
    taskTimeout: CONFIG.YTDLP_TIMEOUT + TIMEOUTS.TASK_BUFFER,
    maxTasksPerWorker: LIMITS.MAX_TASKS_PER_WORKER,
    idleTimeout: TIMEOUTS.WORKER_IDLE,
});

// Initialize circuit breaker for fault tolerance
const circuitBreaker = new CircuitBreaker({
    failureThreshold: LIMITS.CIRCUIT_FAILURE_THRESHOLD,
    successThreshold: LIMITS.CIRCUIT_SUCCESS_THRESHOLD,
    timeout: TIMEOUTS.CIRCUIT_COOLDOWN,
    volumeThreshold: LIMITS.CIRCUIT_VOLUME_THRESHOLD,
    name: "yt-dlp",
});

// Worker pool event handlers
workerPool.on("workerCreated", ({ workerId, totalWorkers }) => {
    logger.info({ workerId, totalWorkers }, "Worker created");
});

workerPool.on("workerDestroyed", ({ workerId, totalWorkers }) => {
    logger.info({ workerId, totalWorkers }, "Worker destroyed");
});

workerPool.on("workerError", ({ workerId, error }) => {
    logger.error({ workerId, error }, "Worker error");
});

workerPool.on("taskQueued", ({ queueLength }) => {
    if (queueLength > 5) {
        logger.warn({ queueLength }, "Task queue building up");
    }
});

// Circuit breaker event handlers
circuitBreaker.on("open", ({ previousState, timestamp }) => {
    logger.error(
        { previousState, timestamp },
        "Circuit breaker opened - yt-dlp calls failing"
    );
    Sentry.captureMessage("Circuit breaker opened for yt-dlp", {
        level: "error",
        tags: { component: "circuit-breaker" },
    });
});

circuitBreaker.on("closed", ({ previousState, timestamp }) => {
    logger.info(
        { previousState, timestamp },
        "Circuit breaker closed - service recovered"
    );
});

circuitBreaker.on("half_open", ({ previousState, timestamp }) => {
    logger.info(
        { previousState, timestamp },
        "Circuit breaker half-open - testing recovery"
    );
});

// Graceful shutdown handling
let isShuttingDown = false;
const activeConnections = new Set();

const shutdown = async (signal) => {
    if (isShuttingDown) {
        logger.warn({ signal }, "Shutdown already in progress, forcing exit");
        process.exit(1);
    }

    isShuttingDown = true;
    logger.info(
        {
            signal,
            activeConnections: activeConnections.size,
            workerPoolStats: workerPool.getStats(),
        },
        "Graceful shutdown initiated"
    );

    // Set shutdown timeout
    const shutdownTimeout = setTimeout(() => {
        logger.error(
            { timeout: TIMEOUTS.SHUTDOWN_GRACE },
            "Shutdown timeout exceeded, forcing exit"
        );
        process.exit(1);
    }, TIMEOUTS.SHUTDOWN_GRACE + 5000); // Extra 5s buffer

    try {
        // Step 1: Stop accepting new connections
        if (server) {
            logger.info("Stopping HTTP server (closing listener)");
            await new Promise((resolve) => {
                server.close(resolve);
            });
            logger.info("HTTP server closed - no new connections accepted");
        }

        // Step 2: Wait for active connections to finish (with timeout)
        const connectionDrainStart = Date.now();
        const maxConnectionDrain = 5000; // 5 seconds max
        
        while (activeConnections.size > 0 && (Date.now() - connectionDrainStart) < maxConnectionDrain) {
            logger.info(
                { activeConnections: activeConnections.size },
                "Waiting for active connections to drain"
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (activeConnections.size > 0) {
            logger.warn(
                { remainingConnections: activeConnections.size },
                "Some connections did not finish in time"
            );
        } else {
            logger.info("All active connections drained");
        }

        // Step 3: Shutdown worker pool (wait for active tasks)
        try {
            logger.info(
                { stats: workerPool.getStats() },
                "Shutting down worker pool"
            );
            await workerPool.shutdown(TIMEOUTS.SHUTDOWN_GRACE);
            logger.info("Worker pool shutdown complete");
        } catch (error) {
            logger.error(
                { error: error.message },
                "Worker pool shutdown error"
            );
        }

        // Step 4: Close Redis connection
        if (redisClient) {
            try {
                logger.info("Closing Redis connection");
                await redisClient.quit();
                logger.info("Redis connection closed");
            } catch (error) {
                logger.error({ error: error.message }, "Redis shutdown error");
            }
        }

        // Step 5: Flush Sentry events
        try {
            logger.info("Flushing Sentry events");
            await Sentry.close(2000);
            logger.info("Sentry events flushed");
        } catch (error) {
            logger.error({ error: error.message }, "Sentry flush error");
        }

        clearTimeout(shutdownTimeout);
        logger.info({ signal }, "Graceful shutdown completed successfully");
        process.exit(0);
    } catch (error) {
        clearTimeout(shutdownTimeout);
        logger.fatal({ error: error.message }, "Fatal error during shutdown");
        process.exit(1);
    }
};

// Handle uncaught exceptions gracefully
process.on("uncaughtException", (error) => {
    logger.fatal(
        { error: error.message, stack: error.stack },
        "Uncaught exception"
    );
    Sentry.captureException(error);
    shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
    logger.fatal({ reason, promise }, "Unhandled promise rejection");
    Sentry.captureException(reason);
    shutdown("unhandledRejection");
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ============================================
// Middleware Configuration
// ============================================

/**
 * Request ID middleware for distributed tracing
 * Generates or extracts correlation ID for tracking requests across services
 */
app.use((req, res, next) => {
    // Check for existing request ID from proxy/load balancer
    const requestId =
        req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);

    // Add to logger context
    req.log = logger.child({ requestId });

    next();
});

/**
 * Request/Response logging middleware
 * Logs all incoming requests and outgoing responses with timing information
 */
app.use((req, res, next) => {
    const startTime = Date.now();
    const startHrTime = process.hrtime();

    // Track active connection
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    activeConnections.add(connectionId);

    // Log incoming request
    req.log.info(
        {
            method: req.method,
            url: req.url,
            path: req.path,
            query: req.query,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            contentType: req.get('content-type'),
            contentLength: req.get('content-length'),
            connectionId,
        },
        'Incoming request'
    );

    // Capture original end function
    const originalEnd = res.end;

    // Override end function to log response
    res.end = function (chunk, encoding) {
        // Remove from active connections
        activeConnections.delete(connectionId);

        const hrDuration = process.hrtime(startHrTime);
        const duration = Date.now() - startTime;
        const durationMs = hrDuration[0] * 1000 + hrDuration[1] / 1000000;

        // Log response
        const logData = {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            durationPrecise: `${durationMs.toFixed(2)}ms`,
            contentLength: res.get('content-length'),
            connectionId,
        };

        if (res.statusCode >= 500) {
            req.log.error(logData, 'Request failed');
        } else if (res.statusCode >= 400) {
            req.log.warn(logData, 'Request error');
        } else {
            req.log.info(logData, 'Request completed');
        }

        // Track performance metrics
        Sentry.addBreadcrumb({
            category: 'http',
            message: `${req.method} ${req.url}`,
            level: res.statusCode >= 400 ? 'error' : 'info',
            data: logData,
        });

        // Call original end
        originalEnd.call(this, chunk, encoding);
    };

    // Check if shutting down
    if (isShuttingDown) {
        res.setHeader('Connection', 'close');
        res.status(503).json({
            ok: false,
            error: 'Server is shutting down',
        });
        activeConnections.delete(connectionId);
        return;
    }

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
app.use(express.json({ limit: LIMITS.REQUEST_BODY }));

// Rate limiting configuration with Redis support
const rateLimitConfig = {
    windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
    message: {
        ok: false,
        error: "Too many requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => CONFIG.NODE_ENV === "development" && !CONFIG.REQUIRE_AUTH,
};

// Use Redis store if available, otherwise fall back to memory store
if (redisClient && CONFIG.REDIS_ENABLED) {
    rateLimitConfig.store = new RedisStore({
        // @ts-expect-error - Known issue with the `call` function not present in @types/redis
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix: "rl:", // Redis key prefix for rate limiting
    });
    logger.info("Using Redis-backed rate limiting (distributed)");
} else {
    logger.warn(
        "Using in-memory rate limiting - NOT suitable for horizontal scaling"
    );
}

const apiLimiter = rateLimit(rateLimitConfig);

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
 * Now uses worker pool and circuit breaker for non-blocking execution
 * and fault tolerance. Workers handle yt-dlp subprocess execution in
 * separate threads to prevent blocking the event loop.
 *
 * @async
 * @param {string} url - The YouTube video URL (must be validated first)
 * @param {number} [maxRetries=2] - Maximum number of retry attempts
 * @returns {Promise<Object>} Parsed JSON metadata from yt-dlp
 * @throws {Error} If yt-dlp fails after all retries or circuit is open
 */
async function extractInfo(url, maxRetries = 2) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Execute through circuit breaker with worker pool
            const data = await circuitBreaker.execute(async () => {
                return await workerPool.execute({
                    url,
                    timeout: CONFIG.YTDLP_TIMEOUT,
                    maxBuffer: CONFIG.YTDLP_MAX_BUFFER,
                    retryAttempt: attempt,
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
        'All retry attempts exhausted for video extraction'
    );

    Sentry.captureException(lastError, {
        tags: {
            component: 'yt-dlp',
            errorType: lastError.code || 'UNKNOWN',
        },
        contexts: {
            extraction: {
                url,
                attempts: maxRetries + 1,
                durationHint,
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
 * Redis health check endpoint
 * Specifically checks Redis connectivity for load balancer health probes
 */
app.get("/health/redis", async (req, res) => {
    if (!CONFIG.REDIS_ENABLED) {
        return res.status(200).json({
            ok: true,
            redis: "disabled",
            message: "Redis is not enabled",
        });
    }

    if (!redisClient) {
        return res.status(503).json({
            ok: false,
            redis: "not_configured",
            message: "Redis client not initialized",
        });
    }

    try {
        // Test Redis connectivity with PING
        const start = Date.now();
        await redisClient.ping();
        const latency = Date.now() - start;

        res.json({
            ok: true,
            redis: "connected",
            latency: `${latency}ms`,
            ready: redisReady,
        });
    } catch (error) {
        logger.error({ error: error.message }, "Redis health check failed");
        res.status(503).json({
            ok: false,
            redis: "error",
            error: error.message,
        });
    }
});

/**
 * Health check endpoint
 * Returns comprehensive system metrics, yt-dlp status, worker pool, and circuit breaker info
 */
app.get("/health", apiLimiter, async (req, res) => {
    try {
        // Get worker pool and circuit breaker status
        const poolStats = workerPool.getStats();
        const breakerStatus = circuitBreaker.getStatus();

        // Check yt-dlp availability and version
        let ytdlpVersion = "unknown";
        let ytdlpAvailable = false;
        try {
            // Use worker pool for health check with dynamic timeout
            const result = await workerPool.execute({
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // Test video
                timeout: TIMEOUTS.HEALTH_CHECK,
                maxBuffer: 1024 * 1024,
                retryAttempt: 0,
            });
            ytdlpAvailable = true;
            ytdlpVersion = "working";
        } catch (error) {
            logger.warn({ error: error.message }, "yt-dlp not available");
        }

        // Determine overall health status
        let overallStatus = "healthy";
        if (!ytdlpAvailable || breakerStatus.state === "OPEN") {
            overallStatus = "degraded";
        }
        if (
            !ytdlpAvailable &&
            (breakerStatus.state === "OPEN" || poolStats.activeWorkers === 0)
        ) {
            overallStatus = "unhealthy";
        }

        // System metrics
        const uptime = Math.floor(process.uptime());
        const memUsage = process.memoryUsage();

        res.json({
            ok: true,
            status: overallStatus,
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
                    path: ytdlpPath,
                    version: ytdlpVersion,
                },
                redis: {
                    enabled: CONFIG.REDIS_ENABLED,
                    connected: redisReady,
                    url: CONFIG.REDIS_URL
                        ? CONFIG.REDIS_URL.replace(/:[^:@]*@/, ":***@")
                        : "not configured",
                },
            },
            workerPool: poolStats,
            circuitBreaker: breakerStatus,
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
                "GET /health/redis": "Redis connectivity check",
                "GET /api/v1/metrics":
                    "Worker pool and circuit breaker metrics",
                "GET /api/v1/openapi": "OpenAPI 3.0 specification",
            },
            api: {
                "POST /api/v1/size": "Extract video size information",
            },
            admin: {
                "POST /api/v1/admin/circuit-breaker/reset":
                    "Reset circuit breaker (requires auth)",
            },
        },
        authentication: CONFIG.REQUIRE_AUTH
            ? "Required: X-API-Key header"
            : "Optional",
        rateLimit: `${CONFIG.RATE_LIMIT_MAX_REQUESTS} requests per ${CONFIG.RATE_LIMIT_WINDOW_MS / 1000} seconds`,
        features: {
            workerPool: "Non-blocking yt-dlp execution with worker threads",
            circuitBreaker: "Automatic failure detection and recovery",
            requestTracing: "X-Request-ID header for distributed tracing",
            retryLogic:
                "Automatic retry with exponential backoff (up to 2 retries)",
            cacheStrategy:
                "Client-side caching recommended (extension handles TTL)",
            openapi: "OpenAPI 3.0 specification available at /api/v1/openapi",
        },
    });
});

/**
 * OpenAPI specification endpoint
 * Serves the complete OpenAPI 3.0 specification
 */
app.get("/api/v1/openapi", (req, res) => {
    try {
        const openApiSpec = require("./openapi.json");
        res.json(openApiSpec);
    } catch (error) {
        logger.error({ error: error.message }, "Failed to load OpenAPI spec");
        res.status(500).json({
            ok: false,
            error: "Failed to load OpenAPI specification",
        });
    }
});

/**
 * Metrics endpoint for monitoring
 * Returns detailed worker pool and circuit breaker metrics
 */
app.get("/api/v1/metrics", (req, res) => {
    const poolStats = workerPool.getStats();
    const breakerStatus = circuitBreaker.getStatus();

    res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        workerPool: poolStats,
        circuitBreaker: breakerStatus,
    });
});

/**
 * Admin endpoint to reset circuit breaker
 * Requires authentication if enabled
 */
app.post(
    "/api/v1/admin/circuit-breaker/reset",
    authenticateApiKey,
    (req, res) => {
        try {
            const oldStatus = circuitBreaker.getStatus();
            circuitBreaker.reset();

            logger.info(
                { oldState: oldStatus.state },
                "Circuit breaker manually reset"
            );

            res.json({
                ok: true,
                message: "Circuit breaker reset successfully",
                previousState: oldStatus.state,
                currentState: circuitBreaker.getStatus().state,
            });
        } catch (error) {
            res.status(500).json({
                ok: false,
                error: error.message,
            });
        }
    }
);

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
            return res.status(400).json({
                ok: false,
                error: "URL is required",
                requestId: req.requestId,
            });
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
        req.log.info(
            { duration, videoId: meta.id },
            "Request completed successfully"
        );

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
        availableEndpoints: [
            "/",
            "/health",
            "/api/v1/size",
            "/api/v1/docs",
            "/api/v1/openapi",
            "/api/v1/metrics",
            "/api/v1/admin/circuit-breaker/reset",
        ],
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

// Store server reference for graceful shutdown
let server;

// Export app for testing
if (typeof module !== "undefined" && module.exports) {
    module.exports = app;
}

// Only start server if not in test mode
if (CONFIG.NODE_ENV !== "test") {
    server = app.listen(CONFIG.PORT, "0.0.0.0", () => {
        logger.info(
            {
                service: "ytdlp-sizer-api",
                version: CONFIG.API_VERSION,
                port: CONFIG.PORT,
                environment: CONFIG.NODE_ENV,
                authRequired: CONFIG.REQUIRE_AUTH,
                rateLimit: `${CONFIG.RATE_LIMIT_MAX_REQUESTS}/min`,
                redis: {
                    enabled: CONFIG.REDIS_ENABLED,
                    connected: redisReady,
                },
                workerPool: {
                    min: workerPool.minWorkers,
                    max: workerPool.maxWorkers,
                },
                circuitBreaker: {
                    enabled: true,
                    threshold: circuitBreaker.failureThreshold,
                },
                endpoints: [
                    "/",
                    "/health",
                    "/health/redis",
                    "/api/v1/size",
                    "/api/v1/docs",
                    "/api/v1/openapi",
                    "/api/v1/metrics",
                ],
            },
            "Server started successfully with worker pool and circuit breaker"
        );

        // Log Redis status
        if (CONFIG.REDIS_ENABLED) {
            if (redisReady) {
                logger.info("✓ Redis distributed rate limiting active");
            } else {
                logger.warn("⚠ Redis enabled but not connected - using memory fallback");
            }
        } else {
            logger.warn("⚠ Redis disabled - in-memory rate limiting (not suitable for horizontal scaling)");
        }

        // Log startup banner
        logger.info("═".repeat(60));
        logger.info(`  YouTube Size Extension - Cloud API v${CONFIG.API_VERSION}`);
        logger.info(`  Listening on http://0.0.0.0:${CONFIG.PORT}`);
        logger.info(`  Environment: ${CONFIG.NODE_ENV}`);
        logger.info(`  Worker Pool: ${workerPool.minWorkers}-${workerPool.maxWorkers} workers`);
        logger.info(`  Circuit Breaker: Enabled (threshold: ${circuitBreaker.failureThreshold})`);
        logger.info(`  Distributed Rate Limiting: ${CONFIG.REDIS_ENABLED ? '✓ Enabled' : '✗ Disabled'}`);
        logger.info("═".repeat(60));
    });

    // Track server connections for graceful shutdown
    server.on('connection', (socket) => {
        socket.on('close', () => {
            // Connection closed naturally
        });
    });
}

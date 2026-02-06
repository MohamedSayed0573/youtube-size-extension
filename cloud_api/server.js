/**
 * Cloud API Server for YouTube Size Extension
 * Refactored modular version
 * @file Cloud API server for yt-dlp size extraction
 * @author YouTube Size Extension Team
 * @version 2.0.0
 */

require("./instrument");
const Sentry = require("@sentry/node");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");
const pino = require("pino");

// Config modules
const { loadConfig } = require("./config/env");
const { TIMEOUTS, LIMITS } = require("./config/constants");
const { initializeRedis } = require("./config/redis");

// Middleware modules
const {
    requestIdMiddleware,
    requestLoggingMiddleware,
} = require("./middleware/logging");
const { createAuthMiddleware } = require("./middleware/auth");
const { createRateLimiter } = require("./middleware/rate-limit");
const { notFoundHandler, errorHandler } = require("./middleware/error-handler");

// Routes
const { createHealthRoutes } = require("./routes/health");
const { createApiRoutes } = require("./routes/api");

// Core services
const WorkerPool = require("./worker-pool");

// ============================================
// Configuration & Logger
// ============================================

const CONFIG = loadConfig();
const ytdlpPath = CONFIG.YTDLP_PATH;

const logger = pino({
    level: CONFIG.LOG_LEVEL || (CONFIG.NODE_ENV === "test" ? "silent" : "info"),
    transport:
        CONFIG.NODE_ENV !== "production" && CONFIG.NODE_ENV !== "test"
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
// Express App Setup
// ============================================

const app = express();

// ============================================
// Redis Setup
// ============================================

const redisState = initializeRedis(CONFIG, logger);
const { redisClient } = redisState;
// Use getter to always get current state
const getRedisReady = () => redisState.redisReady;

// ============================================
// Worker Pool Setup
// ============================================

const workerPool = new WorkerPool({
    minWorkers: CONFIG.MIN_WORKERS || LIMITS.MIN_WORKERS,
    maxWorkers: CONFIG.MAX_WORKERS || LIMITS.MAX_WORKERS,
    taskTimeout: CONFIG.YTDLP_TIMEOUT + TIMEOUTS.TASK_BUFFER,
    maxTasksPerWorker: LIMITS.MAX_TASKS_PER_WORKER,
    idleTimeout: TIMEOUTS.WORKER_IDLE,
});

// Event handlers
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

// ============================================
// Graceful Shutdown Handling
// ============================================

let isShuttingDown = false;
const activeConnections = new Set();

const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    const shutdownTimeout = setTimeout(() => {
        logger.error("Shutdown timeout exceeded, forcing exit");
        process.exit(1);
    }, TIMEOUTS.SHUTDOWN_GRACE + 5000);

    try {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await workerPool.shutdown(TIMEOUTS.SHUTDOWN_GRACE);
        if (redisClient) await redisClient.quit().catch(() => {});
        await Sentry.close(2000).catch(() => {});

        clearTimeout(shutdownTimeout);
        logger.info({ signal }, "Graceful shutdown completed");
        process.exit(0);
    } catch (error) {
        clearTimeout(shutdownTimeout);
        logger.fatal({ error: error.message }, "Fatal error during shutdown");
        process.exit(1);
    }
};

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

// Request ID and logging
app.use(requestIdMiddleware(logger));
app.use(requestLoggingMiddleware(activeConnections, () => isShuttingDown));

// Security headers (helmet)
app.use(
    helmet({
        contentSecurityPolicy: false, // Disable CSP for API server
        crossOriginEmbedderPolicy: false, // Allow embedding for CORS
    })
);

// Gzip compression
app.use(
    compression({
        filter: (req, res) => {
            if (req.headers["x-no-compression"]) {
                return false;
            }
            return compression.filter(req, res);
        },
        level: 6, // Balanced compression
    })
);

// CORS
const corsOptions = {
    origin: CONFIG.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    credentials: true,
};
app.use(cors(corsOptions));

// Body parser
app.use(express.json({ limit: LIMITS.REQUEST_BODY }));

// Rate limiting
const apiLimiter = createRateLimiter(CONFIG, redisClient, logger);

// Authentication
const authMiddleware = createAuthMiddleware(CONFIG);

// ============================================
// Routes
// ============================================

// Health routes (/, /health, /health/redis)
const healthRouter = createHealthRoutes(
    CONFIG,
    workerPool,
    { redisClient, getRedisReady },
    ytdlpPath,
    logger
);
app.use("/", healthRouter);
app.use("/health", healthRouter);

// API v1 routes
const apiRouter = createApiRoutes(
    CONFIG,
    workerPool,
    logger,
    authMiddleware,
    apiLimiter
);
app.use("/api/v1", apiRouter);

// ============================================
// Error Handlers
// ============================================

// 404 handler
app.use(notFoundHandler);

// Sentry error handler (must be before custom error handler)
Sentry.setupExpressErrorHandler(app);

// Global error handler
app.use(errorHandler(logger));

// ============================================
// Server Startup
// ============================================

let server;

// Export app and dependencies for testing
if (typeof module !== "undefined" && module.exports) {
    module.exports = app;
    // Export for test isolation
    module.exports.workerPool = workerPool;
    module.exports.redisClient = redisClient;
}

/**
 * Start the server with proper async initialization
 * Waits for Redis connection before accepting requests
 */
async function startServer() {
    // Wait for Redis to connect (with timeout) before starting
    if (CONFIG.REDIS_ENABLED) {
        logger.info("Waiting for Redis connection...");
        const connected = await redisState.waitForConnection(5000);
        if (connected) {
            logger.info("✓ Redis connected before server start");
        } else {
            logger.warn(
                "⚠ Redis connection timeout - starting with memory fallback"
            );
        }
    }

    // Pre-warm worker pool to avoid cold-start latency on first requests
    logger.info("Warming up worker pool...");
    try {
        await workerPool.warmUp(5000);
        logger.info("✓ Worker pool warmed up successfully");
    } catch (err) {
        logger.warn({ err: err.message }, "⚠ Worker pool warm-up incomplete");
    }

    server = app.listen(CONFIG.PORT, "0.0.0.0", () => {
        const redisReady = getRedisReady();
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
                compression: "enabled (gzip)",
            },
            "Server started successfully"
        );

        // Redis status
        if (CONFIG.REDIS_ENABLED) {
            if (redisReady) {
                logger.info("✓ Redis distributed rate limiting active");
            } else {
                logger.warn(
                    "⚠ Redis enabled but not connected - using memory fallback"
                );
            }
        } else {
            logger.warn(
                "⚠ Redis disabled - in-memory rate limiting (not suitable for horizontal scaling)"
            );
        }

        // Startup banner
        logger.info("═".repeat(60));
        logger.info(
            `  YouTube Size Extension - Cloud API v${CONFIG.API_VERSION}`
        );
        logger.info(`  Listening on http://0.0.0.0:${CONFIG.PORT}`);
        logger.info(`  Environment: ${CONFIG.NODE_ENV}`);
        logger.info(
            `  Worker Pool: ${workerPool.minWorkers}-${workerPool.maxWorkers} workers`
        );
        logger.info(
            `  Distributed Rate Limiting: ${CONFIG.REDIS_ENABLED ? "✓ Enabled" : "✗ Disabled"}`
        );
        logger.info(`  Compression: ✓ Enabled (gzip)`);
        logger.info("═".repeat(60));
    });

    server.on("connection", (socket) => {
        socket.on("close", () => {
            // Connection closed naturally
        });
    });
}

// Only start server if not in test mode
if (CONFIG.NODE_ENV !== "test") {
    startServer().catch((err) => {
        logger.fatal({ error: err.message }, "Failed to start server");
        process.exit(1);
    });
}

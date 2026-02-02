/**
 * Health check routes
 * @module routes/health
 */

const express = require("express");
const os = require("os");
const { formatUptime } = require("../utils/ytdlp");

function createHealthRoutes(
    config,
    workerPool,
    circuitBreaker,
    redisState,
    ytdlpPath,
    logger
) {
    const router = express.Router();
    const { redisClient, redisReady } = redisState;

    /**
     * Root endpoint
     */
    router.get("/", (req, res) => {
        res.json({
            ok: true,
            service: "ytdlp-sizer-api",
            version: config.API_VERSION,
            status: "running",
            documentation: "/api/v1/docs",
        });
    });

    /**
     * Redis health check endpoint
     */
    router.get("/redis", async (req, res) => {
        if (!config.REDIS_ENABLED) {
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
     * Main health check endpoint
     */
    router.get("/main", async (req, res) => {
        try {
            const poolStats = workerPool.getStats();
            const breakerStatus = circuitBreaker.getStatus();

            // Check yt-dlp availability by checking if it's in PATH
            // Don't actually call it to keep health check fast
            let ytdlpVersion = "unknown";
            let ytdlpAvailable = ytdlpPath ? true : false;

            // Determine overall health status
            let overallStatus = "healthy";
            if (!ytdlpAvailable || breakerStatus.state === "OPEN") {
                overallStatus = "degraded";
            }
            if (
                !ytdlpAvailable &&
                (breakerStatus.state === "OPEN" ||
                    poolStats.activeWorkers === 0)
            ) {
                overallStatus = "unhealthy";
            }

            const uptime = Math.floor(process.uptime());
            const memUsage = process.memoryUsage();

            res.json({
                ok: true,
                status: overallStatus,
                timestamp: new Date().toISOString(),
                version: config.API_VERSION,
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
                        enabled: config.REDIS_ENABLED,
                        connected: redisReady,
                        url: config.REDIS_URL
                            ? config.REDIS_URL.replace(/:[^:@]*@/, ":***@")
                            : "not configured",
                    },
                },
                workerPool: poolStats,
                circuitBreaker: breakerStatus,
                config: {
                    environment: config.NODE_ENV,
                    authEnabled: config.REQUIRE_AUTH,
                    corsOrigins:
                        config.ALLOWED_ORIGINS === "*"
                            ? "all"
                            : config.ALLOWED_ORIGINS.length,
                    rateLimit: {
                        windowMs: config.RATE_LIMIT_WINDOW_MS,
                        maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
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

    return router;
}

module.exports = { createHealthRoutes };

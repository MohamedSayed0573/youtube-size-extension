/**
 * Health check routes
 * @module routes/health
 */

const express = require("express");
const os = require("os");
const { formatUptime } = require("../utils/ytdlp");

/**
 * Create health check routes
 * @param {Object} config - Server configuration object
 * @param {Object} workerPool - Worker pool instance
 * @param {Object} redisState - Redis state object with client and getRedisReady
 * @param {string} ytdlpPath - Path to yt-dlp executable
 * @param {import('pino').Logger} logger - Pino logger instance
 * @returns {import('express').Router} Express router instance
 */
function createHealthRoutes(config, workerPool, redisState, ytdlpPath, logger) {
    const router = express.Router();
    const { redisClient, getRedisReady } = redisState;

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
                ready: getRedisReady(),
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
     * Detailed Redis health check endpoint with comprehensive diagnostics
     */
    router.get("/redis/detailed", async (req, res) => {
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

            // Get Redis server info
            const infoRaw = await redisClient.info();
            const info = {};

            // Parse INFO response into sections
            let currentSection = "general";
            for (const line of infoRaw.split("\n")) {
                const trimmed = line.trim();
                if (trimmed.startsWith("#")) {
                    currentSection = trimmed.slice(2).toLowerCase();
                    info[currentSection] = {};
                } else if (trimmed.includes(":")) {
                    const [key, value] = trimmed.split(":");
                    if (!info[currentSection]) info[currentSection] = {};
                    info[currentSection][key] = value;
                }
            }

            // Get key count from dbsize
            const dbsize = await redisClient.dbSize();

            res.json({
                ok: true,
                redis: "connected",
                ready: getRedisReady(),
                latency: `${latency}ms`,
                server: {
                    version: info.server?.redis_version || "unknown",
                    mode: info.server?.redis_mode || "standalone",
                    os: info.server?.os || "unknown",
                    uptimeSeconds:
                        parseInt(info.server?.uptime_in_seconds) || 0,
                    uptimeDays: parseInt(info.server?.uptime_in_days) || 0,
                },
                memory: {
                    used: info.memory?.used_memory_human || "unknown",
                    peak: info.memory?.used_memory_peak_human || "unknown",
                    rss: info.memory?.used_memory_rss_human || "unknown",
                    fragmentation:
                        parseFloat(info.memory?.mem_fragmentation_ratio) || 0,
                },
                clients: {
                    connected: parseInt(info.clients?.connected_clients) || 0,
                    blocked: parseInt(info.clients?.blocked_clients) || 0,
                    maxInputBuffer:
                        info.clients?.client_recent_max_input_buffer || "0",
                    maxOutputBuffer:
                        info.clients?.client_recent_max_output_buffer || "0",
                },
                stats: {
                    totalConnections:
                        parseInt(info.stats?.total_connections_received) || 0,
                    totalCommands:
                        parseInt(info.stats?.total_commands_processed) || 0,
                    opsPerSecond:
                        parseInt(info.stats?.instantaneous_ops_per_sec) || 0,
                    keyspace: {
                        keys: dbsize,
                    },
                },
            });
        } catch (error) {
            logger.error(
                { error: error.message },
                "Detailed Redis health check failed"
            );
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

            // Check yt-dlp availability by checking if it's in PATH
            // Don't actually call it to keep health check fast
            const ytdlpVersion = "unknown";
            const ytdlpAvailable = ytdlpPath ? true : false;

            // Determine overall health status
            let overallStatus = "healthy";
            if (!ytdlpAvailable) {
                overallStatus = "degraded";
            }
            if (!ytdlpAvailable && poolStats.activeWorkers === 0) {
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
                        connected: getRedisReady(),
                        url: config.REDIS_URL
                            ? config.REDIS_URL.replace(/:[^:@]*@/, ":***@")
                            : "not configured",
                    },
                },
                workerPool: poolStats,
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

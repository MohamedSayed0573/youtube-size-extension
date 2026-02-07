/**
 * Health check routes
 * @module routes/health
 */

const express = require("express");
const os = require("os");
const { formatUptime } = require("../utils/ytdlp");
const { CONFIG } = require("../config/env");
const { logger } = require("../config/logger");

/**
 * Create health check routes
 * @param {Object} workerPool - Worker pool instance
 * @param {Object} redisState - Redis state object with client and getRedisReady
 * @param {string} ytdlpPath - Path to yt-dlp executable
 * @returns {import('express').Router} Express router instance
 */
function createHealthRoutes(workerPool, redisState, ytdlpPath) {
    const router = express.Router();
    const { redisClient } = redisState;

    /**
     * Root endpoint
     */
    router.get("/", (req, res) => {
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
     */
    router.get("/redis", async (req, res) => {
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
            const start = Date.now();
            await redisClient.ping();
            const latency = Date.now() - start;

            const status = redisState.getRedisStatus();
            res.json({
                ok: true,
                redis: "connected",
                latency: `${latency}ms`,
                ready: status.ready,
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
            const start = Date.now();
            await redisClient.ping();
            const latency = Date.now() - start;

            const status = redisState.getRedisStatus();

            const info = await redisClient.info("memory").catch(() => null);
            const memoryMatch = info && info.match(/used_memory_human:(\S+)/);

            res.json({
                ok: true,
                redis: "connected",
                latency: `${latency}ms`,
                ready: status.ready,
                url: status.url,
                memory: memoryMatch ? memoryMatch[1] : "unknown",
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
                    redis: redisState.getRedisStatus(),
                },
                workerPool: poolStats,
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

    return router;
}

module.exports = { createHealthRoutes };

/**
 * Main API routes
 * @module routes/api
 */

const express = require("express");
const Sentry = require("@sentry/node");
const { extractInfo, computeSizes } = require("../utils/ytdlp");
const { CONFIG } = require("../config/env");
const { logger } = require("../config/logger");
const { createSizeValidator } = require("../middleware/validation");

/**
 * Create API routes for video size extraction
 * @param {Object} workerPool - Worker pool instance
 * @param {import('express').RequestHandler} authMiddleware - Authentication middleware
 * @param {import('express').RequestHandler} rateLimiter - Rate limiting middleware
 * @returns {import('express').Router} Express router instance
 */
function createApiRoutes(workerPool, authMiddleware, rateLimiter) {
    const router = express.Router();

    /**
     * API documentation endpoint
     */
    router.get("/docs", (req, res) => {
        res.json({
            version: CONFIG.API_VERSION,
            service: "ytdlp-sizer-api",
            description: "API for extracting YouTube video size information",
            endpoints: {
                health: {
                    "GET /": "Root endpoint with basic info",
                    "GET /health": "Health check with system metrics",
                    "GET /health/redis": "Redis connectivity check",
                    "GET /api/v1/metrics": "Worker pool metrics",
                    "GET /api/v1/openapi": "OpenAPI 3.0 specification",
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
                workerPool: "Non-blocking yt-dlp execution with worker threads",
                requestTracing: "X-Request-ID header for distributed tracing",
                retryLogic:
                    "Automatic retry with exponential backoff (up to 2 retries)",
                cacheStrategy:
                    "Client-side caching recommended (extension handles TTL)",
                openapi:
                    "OpenAPI 3.0 specification available at /api/v1/openapi",
            },
        });
    });

    /**
     * OpenAPI specification endpoint
     */
    router.get("/openapi", (req, res) => {
        try {
            const openApiSpec = require("../openapi.json");
            res.json(openApiSpec);
        } catch (error) {
            logger.error(
                { error: error.message },
                "Failed to load OpenAPI spec"
            );
            res.status(500).json({
                ok: false,
                error: "Failed to load OpenAPI specification",
            });
        }
    });

    /**
     * Metrics endpoint
     */
    router.get("/metrics", (req, res) => {
        const poolStats = workerPool.getStats();

        res.json({
            ok: true,
            timestamp: new Date().toISOString(),
            workerPool: poolStats,
        });
    });

    /**
     * Main size extraction endpoint
     */
    router.post(
        "/size",
        rateLimiter,
        authMiddleware,
        createSizeValidator(),
        async (req, res) => {
            const startTime = Date.now();
            try {
                const { url, duration_hint, cookies } = req.body;

                Sentry.addBreadcrumb({
                    category: "api",
                    message: "Video size request received",
                    data: { url, duration_hint, requestId: req.requestId },
                    level: "info",
                });

                req.log.info(
                    { url, hasCookies: !!cookies },
                    "Processing size request"
                );

                // Extract metadata using yt-dlp (with retries)
                // Pass cookies if provided to bypass YouTube bot detection
                const meta = await extractInfo(
                    url,
                    workerPool,
                    CONFIG,
                    logger,
                    2, // maxRetries
                    cookies // cookies from browser extension
                );

                // Compute sizes
                const result = computeSizes(meta, duration_hint);

                const duration = Date.now() - startTime;
                req.log.info(
                    { duration, videoId: meta.id },
                    "Request completed successfully"
                );

                // Set cache headers for client-side caching
                res.setHeader("Cache-Control", "private, max-age=3600"); // 1 hour cache
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
                const statusCode = error.statusCode || 500;

                res.status(statusCode).json({
                    ok: false,
                    error: error.message,
                    requestId: req.requestId,
                    code: error.code || "INTERNAL_ERROR",
                });
            }
        }
    );

    return router;
}

module.exports = { createApiRoutes };

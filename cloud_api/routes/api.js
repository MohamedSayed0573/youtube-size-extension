/**
 * Main API routes
 * @module routes/api
 */

const express = require("express");
const Sentry = require("@sentry/node");
const {
    isValidYouTubeUrl,
    extractInfo,
    computeSizes,
} = require("../utils/ytdlp");

function createApiRoutes(
    config,
    workerPool,
    circuitBreaker,
    logger,
    authMiddleware,
    rateLimiter
) {
    const router = express.Router();

    /**
     * API documentation endpoint
     */
    router.get("/docs", (req, res) => {
        res.json({
            version: config.API_VERSION,
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
            authentication: config.REQUIRE_AUTH
                ? "Required: X-API-Key header"
                : "Optional",
            rateLimit: `${config.RATE_LIMIT_MAX_REQUESTS} requests per ${config.RATE_LIMIT_WINDOW_MS / 1000} seconds`,
            features: {
                workerPool: "Non-blocking yt-dlp execution with worker threads",
                circuitBreaker: "Automatic failure detection and recovery",
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
        const breakerStatus = circuitBreaker.getStatus();

        res.json({
            ok: true,
            timestamp: new Date().toISOString(),
            workerPool: poolStats,
            circuitBreaker: breakerStatus,
        });
    });

    /**
     * Main size extraction endpoint
     */
    router.post("/size", rateLimiter, authMiddleware, async (req, res) => {
        const startTime = Date.now();
        try {
            const { url, duration_hint } = req.body;

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
            const meta = await extractInfo(
                url,
                workerPool,
                circuitBreaker,
                config,
                logger
            );

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

    return router;
}

module.exports = { createApiRoutes };

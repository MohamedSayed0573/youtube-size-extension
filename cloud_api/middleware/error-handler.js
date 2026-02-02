/**
 * Error handling middleware
 * @module middleware/error-handler
 */

const Sentry = require("@sentry/node");

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
    res.status(404).json({
        ok: false,
        error: "Endpoint not found",
        availableEndpoints: [
            "/",
            "/health",
            "/health/redis",
            "/api/v1/size",
            "/api/v1/docs",
            "/api/v1/openapi",
            "/api/v1/metrics",
            "/api/v1/admin/circuit-breaker/reset",
        ],
    });
}

/**
 * Global error handler
 * Must be registered after Sentry error handler
 */
function errorHandler(logger) {
    return (err, req, res, next) => {
        // Error already captured by Sentry middleware
        logger.error(
            { err, path: req.path, method: req.method },
            "Unhandled error"
        );
        res.status(500).json({
            ok: false,
            error: "Internal server error",
        });
    };
}

module.exports = { notFoundHandler, errorHandler };

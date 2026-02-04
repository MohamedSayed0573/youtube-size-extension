/**
 * Error handling middleware
 * @module middleware/error-handler
 */

const Sentry = require("@sentry/node");

/**
 * 404 Not Found handler
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
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
 * @param {import('pino').Logger} logger - Pino logger instance
 * @returns {import('express').ErrorRequestHandler} Express error middleware function
 */
function errorHandler(logger) {
    return (err, req, res, _next) => {
        // Handle Express built-in errors with proper status codes
        if (err.status) {
            // Express errors (body-parser, multer, etc.) have .status property
            logger.warn(
                { error: err.message, status: err.status, path: req.path },
                "Express middleware error"
            );
            return res.status(err.status).json({
                ok: false,
                error: err.message || "Request error",
            });
        }

        // Handle SyntaxError from malformed JSON
        if (err instanceof SyntaxError && err.message.includes("JSON")) {
            logger.warn(
                { error: err.message, path: req.path },
                "Malformed JSON"
            );
            return res.status(400).json({
                ok: false,
                error: "Invalid JSON in request body",
            });
        }

        // Handle payload too large errors
        if (err.type === "entity.too.large") {
            logger.warn({ path: req.path }, "Payload too large");
            return res.status(413).json({
                ok: false,
                error: "Payload too large",
            });
        }

        // Default 500 for unexpected errors
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

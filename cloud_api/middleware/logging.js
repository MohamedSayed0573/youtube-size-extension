/**
 * Logging middleware
 * @module middleware/logging
 */

const Sentry = require("@sentry/node");
const { LIMITS } = require("../config/constants");
const { logger } = require("../config/logger");

/**
 * Request ID middleware for distributed tracing
 * Generates or extracts correlation ID for tracking requests across services
 * @returns {import('express').RequestHandler} Express middleware function
 */
function requestIdMiddleware() {
    return (req, res, next) => {
        // Check for existing request ID from proxy/load balancer
        const requestId =
            req.headers["x-request-id"] ||
            req.headers["x-correlation-id"] ||
            `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Sanitize Request ID to prevent log injection and limit length
        req.requestId = requestId
            .replace(/[^a-zA-Z0-9_-]/gu, "")
            .slice(0, LIMITS.REQUEST_ID_MAX_LENGTH);
        res.setHeader("X-Request-ID", req.requestId);

        // Add to logger context
        req.log = logger.child({ requestId });

        next();
    };
}

/**
 * Request/Response logging middleware
 * Logs all incoming requests and outgoing responses with timing information
 * @param {Set<string>} activeConnections - Set to track active connection IDs
 * @param {() => boolean} isShuttingDown - Function that returns true if server is shutting down
 * @returns {import('express').RequestHandler} Express middleware function
 */
function requestLoggingMiddleware(activeConnections, isShuttingDown) {
    return (req, res, next) => {
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
                userAgent: req.get("user-agent"),
                contentType: req.get("content-type"),
                contentLength: req.get("content-length"),
                connectionId,
            },
            "Incoming request"
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
                contentLength: res.get("content-length"),
                connectionId,
            };

            if (res.statusCode >= 500) {
                req.log.error(logData, "Request failed");
            } else if (res.statusCode >= 400) {
                req.log.warn(logData, "Request error");
            } else {
                req.log.info(logData, "Request completed");
            }

            // Track performance metrics
            Sentry.addBreadcrumb({
                category: "http",
                message: `${req.method} ${req.url}`,
                level: res.statusCode >= 400 ? "error" : "info",
                data: logData,
            });

            // Call original end
            originalEnd.call(this, chunk, encoding);
        };

        // Check if shutting down
        if (isShuttingDown()) {
            res.setHeader("Connection", "close");
            res.status(503).json({
                ok: false,
                error: "Server is shutting down",
            });
            activeConnections.delete(connectionId);
            return;
        }

        next();
    };
}

module.exports = { requestIdMiddleware, requestLoggingMiddleware };

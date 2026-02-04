/**
 * Admin routes
 * @module routes/admin
 */

const express = require("express");

/**
 * Create admin routes for system management
 * @param {Object} circuitBreaker - Circuit breaker instance
 * @param {import('pino').Logger} logger - Pino logger instance
 * @param {import('express').RequestHandler} authMiddleware - Authentication middleware
 * @returns {import('express').Router} Express router instance
 */
function createAdminRoutes(circuitBreaker, logger, authMiddleware) {
    const router = express.Router();

    /**
     * Reset circuit breaker endpoint
     */
    router.post("/circuit-breaker/reset", authMiddleware, (req, res) => {
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
    });

    return router;
}

module.exports = { createAdminRoutes };

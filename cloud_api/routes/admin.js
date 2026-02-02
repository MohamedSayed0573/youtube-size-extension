/**
 * Admin routes
 * @module routes/admin
 */

const express = require("express");

/**
 *
 * @param circuitBreaker
 * @param logger
 * @param authMiddleware
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

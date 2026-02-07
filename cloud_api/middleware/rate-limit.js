/**
 * Rate limiting configuration
 * @module middleware/rate-limit
 */

const rateLimit = require("express-rate-limit");
const { default: RedisStore } = require("rate-limit-redis");
const { CONFIG } = require("../config/env");
const { logger } = require("../config/logger");

/**
 * Create rate limiter with Redis or memory store
 * @param {Object} redisClient - Redis client (optional)
 * @returns {Function} Express rate limit middleware
 */
function createRateLimiter(redisClient) {
    const rateLimitConfig = {
        windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
        max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
        message: {
            ok: false,
            error: "Too many requests, please try again later.",
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) =>
            CONFIG.NODE_ENV === "development" && !CONFIG.REQUIRE_AUTH,
    };

    // Use Redis store if available, otherwise fall back to memory store
    if (redisClient && CONFIG.REDIS_ENABLED) {
        rateLimitConfig.store = new RedisStore({
            // @ts-expect-error - Known issue with the `call` function not present in @types/redis
            sendCommand: (...args) => redisClient.sendCommand(args),
            prefix: "rl:", // Redis key prefix for rate limiting
        });
        logger.info("Using Redis-backed rate limiting (distributed)");
    } else {
        logger.warn(
            "Using in-memory rate limiting - NOT suitable for horizontal scaling"
        );
    }

    return rateLimit(rateLimitConfig);
}

module.exports = { createRateLimiter };

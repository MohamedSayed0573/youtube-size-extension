/**
 * Redis client initialization and configuration
 * @module config/redis
 */

const redis = require("redis");

/**
 * Initialize Redis client with event handlers
 * @param {Object} config - Configuration object
 * @param {Object} logger - Pino logger instance
 * @returns {Object} Redis client and state
 */
function initializeRedis(config, logger) {
    if (!config.REDIS_ENABLED) {
        logger.info(
            "Redis not enabled - using in-memory rate limiting (not recommended for production with multiple instances)"
        );
        return { redisClient: null, redisReady: false };
    }

    const redisOptions = {
        url: config.REDIS_URL,
        password: config.REDIS_PASSWORD,
        socket: {
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    logger.error("Redis connection failed after 10 retries");
                    return new Error("Redis connection failed");
                }
                const delay = Math.min(retries * 100, 3000);
                logger.warn(
                    { retries, delay },
                    "Reconnecting to Redis after delay"
                );
                return delay;
            },
        },
    };

    const redisClient = redis.createClient(redisOptions);
    let redisReady = false;

    // Event handlers
    redisClient.on("error", (err) => {
        logger.error({ error: err.message }, "Redis client error");
        redisReady = false;
    });

    redisClient.on("connect", () => {
        logger.info("Redis client connecting");
    });

    redisClient.on("ready", () => {
        logger.info("Redis client ready");
        redisReady = true;
    });

    redisClient.on("reconnecting", () => {
        logger.warn("Redis client reconnecting");
        redisReady = false;
    });

    redisClient.on("end", () => {
        logger.info("Redis client disconnected");
        redisReady = false;
    });

    // Connect to Redis
    redisClient
        .connect()
        .then(() => {
            logger.info(
                { url: config.REDIS_URL },
                "Redis connection established"
            );
        })
        .catch((err) => {
            logger.error(
                { error: err.message },
                "Failed to connect to Redis - falling back to memory store"
            );
            const Sentry = require("@sentry/node");
            Sentry.captureException(err, {
                tags: { component: "redis", severity: "warning" },
            });
        });

    return {
        redisClient,
        get redisReady() {
            return redisReady;
        },
    };
}

module.exports = { initializeRedis };

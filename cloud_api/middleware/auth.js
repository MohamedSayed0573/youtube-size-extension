/**
 * Authentication middleware
 * @module middleware/auth
 */

/**
 * Middleware to verify API key authentication
 *
 * Checks X-API-Key header against configured API_KEY environment variable.
 * Skips authentication if REQUIRE_AUTH is false (development mode).
 * @param {Object} config - Configuration object
 * @returns {Function} Express middleware function
 */
function createAuthMiddleware(config) {
    return function authenticateApiKey(req, res, next) {
        // Skip auth if not required (development)
        if (!config.REQUIRE_AUTH) {
            return next();
        }

        const apiKey = req.headers["x-api-key"];

        if (!apiKey || apiKey !== config.API_KEY) {
            return res.status(401).json({
                ok: false,
                error: "Unauthorized. Valid API key required.",
            });
        }

        next();
    };
}

module.exports = { createAuthMiddleware };

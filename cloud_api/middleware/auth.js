/**
 * Authentication middleware
 * @module middleware/auth
 */

const crypto = require("crypto");

/**
 * Constant-time comparison of two strings to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function safeCompare(a, b) {
    if (typeof a !== "string" || typeof b !== "string") {
        return false;
    }
    // Ensure both buffers are same length to prevent length-based timing leaks
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Compare against self to maintain constant time even on length mismatch
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Middleware to verify API key authentication
 *
 * Checks X-API-Key header against configured API_KEY environment variable.
 * Skips authentication if REQUIRE_AUTH is false (development mode).
 * Uses constant-time comparison to prevent timing attacks.
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

        if (!apiKey || !safeCompare(apiKey, config.API_KEY)) {
            return res.status(401).json({
                ok: false,
                error: "Unauthorized. Valid API key required.",
            });
        }

        next();
    };
}

module.exports = { createAuthMiddleware, safeCompare };

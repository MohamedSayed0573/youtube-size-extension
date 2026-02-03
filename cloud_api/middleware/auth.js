/**
 * Authentication middleware
 * @module middleware/auth
 */

const crypto = require("crypto");

/** @constant {number} Minimum required API key length for security */
const MIN_API_KEY_LENGTH = 16;

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
 * Validate that API key meets security requirements
 * @param {string} apiKey - The API key to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string") {
        return { valid: false, error: "API key is not configured" };
    }

    if (apiKey.trim().length === 0) {
        return { valid: false, error: "API key cannot be empty" };
    }

    if (apiKey.length < MIN_API_KEY_LENGTH) {
        return {
            valid: false,
            error: `API key must be at least ${MIN_API_KEY_LENGTH} characters for security`,
        };
    }

    return { valid: true };
}

/**
 * Middleware to verify API key authentication
 *
 * Checks X-API-Key header against configured API_KEY environment variable.
 * Skips authentication if REQUIRE_AUTH is false (development mode).
 * Uses constant-time comparison to prevent timing attacks.
 * @param {Object} config - Configuration object
 * @returns {Function} Express middleware function
 * @throws {Error} If REQUIRE_AUTH is true but API_KEY is invalid
 */
function createAuthMiddleware(config) {
    // Validate API key configuration at middleware creation time
    if (config.REQUIRE_AUTH) {
        const validation = validateApiKey(config.API_KEY);
        if (!validation.valid) {
            throw new Error(
                `Authentication is required but API key is invalid: ${validation.error}. ` +
                    `Set a valid API_KEY environment variable (minimum ${MIN_API_KEY_LENGTH} characters) ` +
                    `or disable authentication by setting REQUIRE_AUTH=false.`
            );
        }
    }

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

module.exports = {
    createAuthMiddleware,
    safeCompare,
    validateApiKey,
    MIN_API_KEY_LENGTH,
};

/**
 * Environment configuration with Zod validation
 * @module config/env
 */

const { z } = require("zod");

const envSchema = z
    .object({
        // Server configuration
        PORT: z.string().default("3000").transform(Number),
        NODE_ENV: z
            .enum(["development", "staging", "production", "test"])
            .default("development"),

        // Authentication
        API_KEY: z.string().optional().default(""),
        REQUIRE_AUTH: z
            .string()
            .transform((val) => val === "true")
            .default("false"),

        // CORS
        ALLOWED_ORIGINS: z
            .string()
            .default("")
            .transform((val) => (val === "*" ? "*" : val.split(","))),

        // Redis
        REDIS_URL: z.string().optional(),
        REDIS_PASSWORD: z.string().optional(),
        REDIS_ENABLED: z
            .string()
            .transform((val) => val === "true")
            .optional()
            .default("false"),

        // Rate limiting
        RATE_LIMIT_WINDOW_MS: z
            .string()
            .optional()
            .default("600000")
            .transform(Number), // 10 minutes
        RATE_LIMIT_MAX_REQUESTS: z
            .string()
            .optional()
            .default("60")
            .transform(Number),

        // Worker pool
        MIN_WORKERS: z
            .string()
            .optional()
            .transform((val) => {
                if (!val) return undefined;
                return Number(val);
            }),
        MAX_WORKERS: z
            .string()
            .optional()
            .transform((val) => {
                if (!val) return undefined;
                return Number(val);
            }),

        // yt-dlp configuration
        YTDLP_TIMEOUT: z.string().optional().default("25000").transform(Number),
        YTDLP_MAX_BUFFER: z
            .string()
            .optional()
            .default("10485760")
            .transform(Number), // 10 MB
        YTDLP_PATH: z.string().optional().default("yt-dlp"),

        // API versioning
        API_VERSION: z.string().optional().default("2.0.0"),

        // Sentry (loaded from instrument.js)
        SENTRY_DSN: z.string().optional(),
    })
    .transform((env) => ({
        ...env,
        // Auto-enable Redis if URL is provided
        REDIS_ENABLED:
            env.REDIS_ENABLED === "true" ||
            (!!env.REDIS_URL && env.REDIS_URL.length > 0),
    }));

/**
 * Parse and validate environment variables
 * @returns {Object} Validated configuration object
 * @throws {Error} If validation fails
 */
function loadConfig() {
    try {
        return envSchema.parse(process.env);
    } catch (error) {
        console.error("❌ Environment configuration validation failed:");
        if (error.errors) {
            error.errors.forEach((err) => {
                console.error(`  - ${err.path.join(".")}: ${err.message}`);
            });
        }
        throw new Error("Invalid environment configuration");
    }
}

module.exports = { loadConfig };

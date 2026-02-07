/**
 * Request validation middleware using Zod
 * @module middleware/validation
 */

const { z } = require("zod");
const { isValidYouTubeUrl } = require("../utils/ytdlp");

/**
 * Zod schema for size endpoint request body
 */
const sizeRequestSchema = z.object({
    url: z
        .string({
            required_error: "URL is required",
            invalid_type_error: "URL must be a string",
        })
        .refine((url) => isValidYouTubeUrl(url), {
            message: "Invalid or unsafe YouTube URL",
        }),
    duration_hint: z
        .number({
            invalid_type_error: "duration_hint must be a number",
        })
        .min(0, "duration_hint must be at least 0")
        .max(86400, "duration_hint cannot exceed 86400 seconds (24 hours)")
        .optional(),
});

/**
 * Create validation middleware for size endpoint
 * Validates request body against Zod schema before processing
 * @returns {import('express').RequestHandler} Express middleware function
 */
function createSizeValidator() {
    return (req, res, next) => {
        const result = sizeRequestSchema.safeParse(req.body);

        if (!result.success) {
            const errors = result.error.errors.map((e) => ({
                field: e.path.join("."),
                message: e.message,
            }));

            return res.status(400).json({
                ok: false,
                error: "Validation failed",
                details: errors,
                requestId: req.requestId,
            });
        }

        // Attach validated data to request
        req.validatedBody = result.data;
        next();
    };
}

/**
 * Generic validation middleware factory
 * Creates validation middleware for any Zod schema
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {import('express').RequestHandler} Express middleware function
 */
function createValidator(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const errors = result.error.errors.map((e) => ({
                field: e.path.join("."),
                message: e.message,
            }));

            return res.status(400).json({
                ok: false,
                error: "Validation failed",
                details: errors,
                requestId: req.requestId,
            });
        }

        req.validatedBody = result.data;
        next();
    };
}

module.exports = {
    createSizeValidator,
    createValidator,
    sizeRequestSchema,
};

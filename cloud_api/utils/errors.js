/**
 * Custom Error Classes for Cloud API
 * @module utils/errors
 */

class AppError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true; // Distinguish operational errors from programming bugs
        Error.captureStackTrace(this, this.constructor);
    }
}

class TimeoutError extends AppError {
    constructor(message = "Operation timed out") {
        super(message, 504, "TIMEOUT");
    }
}

class NotFoundError extends AppError {
    constructor(message = "Resource not found") {
        super(message, 503, "NOT_FOUND"); // 503 Service Unavailable often more appropriate for missing dependencies
    }
}

class ValidationError extends AppError {
    constructor(message = "Validation failed") {
        super(message, 400, "VALIDATION_ERROR");
    }
}

class UpstreamError extends AppError {
    constructor(message = "Upstream service failure") {
        super(message, 502, "UPSTREAM_ERROR");
    }
}

class RateLimitError extends AppError {
    constructor(message = "Too many requests") {
        super(message, 429, "RATE_LIMIT_EXCEEDED");
    }
}

module.exports = {
    AppError,
    TimeoutError,
    NotFoundError,
    ValidationError,
    UpstreamError,
    RateLimitError,
};

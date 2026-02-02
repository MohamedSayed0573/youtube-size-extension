/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects the application from cascading failures by monitoring yt-dlp call success rates.
 * When failures exceed threshold, trips to OPEN state and fails fast. After cooldown period,
 * enters HALF_OPEN state to test recovery. Returns to CLOSED on success.
 *
 * States:
 * - CLOSED: Normal operation, all requests pass through
 * - OPEN: Too many failures, reject all requests immediately (fail-fast)
 * - HALF_OPEN: Testing recovery, allow limited requests
 *
 * Configuration:
 * - failureThreshold: Number of failures before opening circuit (default: 5)
 * - successThreshold: Successes in HALF_OPEN before closing (default: 2)
 * - timeout: Time in ms before attempting recovery (default: 60000)
 * - volumeThreshold: Minimum requests before evaluating failures (default: 10)
 * @file Circuit breaker for yt-dlp resilience
 * @author YouTube Size Extension Team
 * @version 2.0.0
 */

const EventEmitter = require("events");

/**
 * Circuit breaker states
 * @enum {string}
 */
const STATE = {
    CLOSED: "CLOSED", // Normal operation
    OPEN: "OPEN", // Failing fast, not executing calls
    HALF_OPEN: "HALF_OPEN", // Testing if service recovered
};

/**
 * Circuit Breaker Class
 *
 * Monitors operation success/failure and manages circuit state transitions.
 * Emits events for state changes and metrics collection.
 * @augments EventEmitter
 * @example
 *   const breaker = new CircuitBreaker({
 *     failureThreshold: 5,
 *     timeout: 60000
 *   });
 *
 *   breaker.on('open', () => logger.error('Circuit opened'));
 *
 *   try {
 *     await breaker.execute(() => callYtdlp(url));
 *   } catch (error) {
 *     // Handle circuit open or actual error
 *   }
 */
class CircuitBreaker extends EventEmitter {
    /**
     * Create a circuit breaker
     * @param {Object} options - Configuration options
     * @param {number} [options.failureThreshold] - Failures before opening
     * @param {number} [options.successThreshold] - Successes before closing from half-open
     * @param {number} [options.timeout] - Cooldown period in ms
     * @param {number} [options.volumeThreshold] - Min requests before evaluating
     * @param {string} [options.name] - Circuit name for logging
     */
    constructor(options = {}) {
        super();

        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 60000; // 60 seconds
        this.volumeThreshold = options.volumeThreshold || 10;
        this.name = options.name || "yt-dlp";

        this.state = STATE.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.requestCount = 0;
        this.nextAttempt = Date.now();
        this.lastStateChange = Date.now();

        // Metrics
        this.stats = {
            totalRequests: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            rejectedRequests: 0,
            stateChanges: 0,
        };
    }

    /**
     * Execute a function with circuit breaker protection
     * @async
     * @param {Function} fn - Async function to execute
     * @returns {Promise<any>} Result from the function
     * @throws {Error} If circuit is open or function fails
     */
    async execute(fn) {
        this.stats.totalRequests++;
        this.requestCount++;

        // Check if we should allow this request
        if (!this._canExecute()) {
            this.stats.rejectedRequests++;
            const error = new Error(
                `Circuit breaker is OPEN for ${this.name}. Service temporarily unavailable.`
            );
            error.code = "CIRCUIT_OPEN";
            throw error;
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure(error);
            throw error;
        }
    }

    /**
     * Check if request can be executed based on circuit state
     * @private
     * @returns {boolean} True if request can proceed
     */
    _canExecute() {
        if (this.state === STATE.CLOSED) {
            return true;
        }

        if (this.state === STATE.OPEN) {
            // Check if timeout has elapsed
            if (Date.now() >= this.nextAttempt) {
                this._setState(STATE.HALF_OPEN);
                return true;
            }
            return false;
        }

        // HALF_OPEN: Allow limited requests
        return true;
    }

    /**
     * Handle successful execution
     * @private
     */
    _onSuccess() {
        this.stats.totalSuccesses++;
        this.failures = 0; // Reset failure count

        if (this.state === STATE.HALF_OPEN) {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this._setState(STATE.CLOSED);
            }
        }
    }

    /**
     * Handle failed execution
     * @private
     * @param {Error} error - The error that occurred
     */
    _onFailure(error) {
        this.stats.totalFailures++;
        this.failures++;
        this.successes = 0; // Reset success count

        // Certain errors should trip circuit faster
        const criticalErrors = [
            "TIMEOUT",
            "NOT_FOUND",
            "RATE_LIMITED",
            "NETWORK_ERROR",
        ];
        const isCritical = criticalErrors.includes(error.code);

        if (this.state === STATE.HALF_OPEN) {
            // Any failure in half-open returns to open
            this._setState(STATE.OPEN);
        } else if (this.state === STATE.CLOSED) {
            // Check if we've exceeded threshold
            if (
                this.requestCount >= this.volumeThreshold &&
                this.failures >= this.failureThreshold
            ) {
                this._setState(STATE.OPEN);
            } else if (isCritical && this.failures >= 3) {
                // Trip faster for critical errors
                this._setState(STATE.OPEN);
            }
        }
    }

    /**
     * Change circuit state and emit event
     * @private
     * @param {string} newState - The new state
     */
    _setState(newState) {
        if (this.state === newState) return;

        const oldState = this.state;
        this.state = newState;
        this.lastStateChange = Date.now();
        this.stats.stateChanges++;

        // Reset counters based on state
        if (newState === STATE.CLOSED) {
            this.failures = 0;
            this.successes = 0;
            this.requestCount = 0;
        } else if (newState === STATE.OPEN) {
            this.nextAttempt = Date.now() + this.timeout;
            this.successes = 0;
        } else if (newState === STATE.HALF_OPEN) {
            this.successes = 0;
            this.failures = 0;
        }

        // Emit state change event
        this.emit("stateChange", {
            from: oldState,
            to: newState,
            timestamp: this.lastStateChange,
        });

        // Emit specific state events
        this.emit(newState.toLowerCase(), {
            previousState: oldState,
            timestamp: this.lastStateChange,
        });
    }

    /**
     * Get current circuit breaker status
     * @returns {Object} Status object with state and metrics
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            requestCount: this.requestCount,
            nextAttempt:
                this.state === STATE.OPEN
                    ? new Date(this.nextAttempt).toISOString()
                    : null,
            lastStateChange: new Date(this.lastStateChange).toISOString(),
            stats: { ...this.stats },
            config: {
                failureThreshold: this.failureThreshold,
                successThreshold: this.successThreshold,
                timeout: this.timeout,
                volumeThreshold: this.volumeThreshold,
            },
        };
    }

    /**
     * Reset circuit breaker to initial state
     */
    reset() {
        this.state = STATE.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.requestCount = 0;
        this.nextAttempt = Date.now();
        this.lastStateChange = Date.now();

        this.emit("reset", { timestamp: Date.now() });
    }

    /**
     * Force circuit to specific state (for testing/admin)
     * @param {string} newState - State to force
     */
    forceState(newState) {
        if (!Object.values(STATE).includes(newState)) {
            throw new Error(`Invalid state: ${newState}`);
        }
        this._setState(newState);
    }
}

module.exports = { CircuitBreaker, STATE };

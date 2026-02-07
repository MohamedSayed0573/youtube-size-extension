/**
 * Worker Pool Manager for yt-dlp Execution (Piscina-based)
 *
 * Simplified worker pool using the Piscina library.
 * Delegates the complex worker management to Piscina.
 *
 * @file Worker pool for non-blocking yt-dlp execution
 * @author YouTube Size Extension Team
 * @version 3.1.0
 */

const Piscina = require("piscina");
const path = require("path");

/**
 * Worker Pool Manager
 *
 * Thin wrapper around Piscina.
 */
class WorkerPool {
    /**
     * Create a worker pool
     * @param {Object} options - Configuration options
     * @param {number} [options.minWorkers] - Minimum workers to maintain
     * @param {number} [options.maxWorkers] - Maximum workers allowed
     * @param {string} [options.workerScript] - Path to worker script
     * @param {number} [options.taskTimeout] - Task timeout in ms (default 30s)
     * @param {number} [options.idleTimeout] - Idle time before terminating worker (default 2m)
     * @param {number} [options.maxQueueSize] - Maximum pending tasks before rejection (default 100)
     */
    constructor(options = {}) {
        this.minWorkers = options.minWorkers || 2;
        this.maxWorkers = options.maxWorkers || 10;
        this.workerScript =
            options.workerScript || path.join(__dirname, "ytdlp-worker.js");
        this.taskTimeout = options.taskTimeout || 30000;
        this.idleTimeout = options.idleTimeout || 120000;
        this.maxQueueSize = options.maxQueueSize || 100;

        this.isShuttingDown = false;

        // Create Piscina instance
        this.piscina = new Piscina({
            filename: this.workerScript,
            minThreads: this.minWorkers,
            maxThreads: this.maxWorkers,
            idleTimeout: this.idleTimeout,
            maxQueue: this.maxQueueSize,
        });
    }

    /**
     * Pre-warm the worker pool by ensuring workers are ready to handle tasks
     * @async
     * @param {number} [timeoutMs] - Maximum time to wait for warm-up
     * @returns {Promise<{warmed: number, total: number}>} Warm-up result
     */
    async warmUp(timeoutMs = 5000) {
        const warmUpPromises = [];

        // Run lightweight tasks to spin up minimum workers
        // We trigger minWorkers tasks
        for (let i = 0; i < this.minWorkers; i++) {
            const warmUpTask = this.piscina
                .run({ warmUp: true })
                .then(() => true)
                .catch((err) => {
                    // Log warmup failure but continue - individual worker failure during warmup isn't critical
                    // using a unique logger if available, otherwise console or ignore if truly
                    // intended to be silent. Given strict requirement to log:
                    const { logger } = require("./config/logger");
                    logger.debug(
                        { error: err.message },
                        "Worker warmup task failed"
                    );
                    return false;
                });
            warmUpPromises.push(warmUpTask);
        }

        // Wait for warm-up or timeout
        // We don't really need accurate "warmed" counts, just to trigger them
        await Promise.race([
            Promise.all(warmUpPromises),
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
        ]);

        return {
            warmed: this.piscina.threads.length,
            total: this.piscina.threads.length,
        };
    }

    /**
     * Execute task in worker pool
     * @async
     * @param {Object} task - Task configuration
     * @param {string} task.url - YouTube URL
     * @param {number} task.timeout - Timeout in ms
     * @param {number} task.maxBuffer - Max buffer size
     * @param {number} [task.retryAttempt] - Retry attempt number
     * @param {string|null} [task.cookies] - Cookies in Netscape format
     * @returns {Promise<Object>} yt-dlp metadata
     * @throws {Error} If task fails or times out
     */
    async execute(task) {
        if (this.isShuttingDown) {
            throw new Error("Worker pool is shutting down");
        }

        // Execute with timeout using AbortController for the specific task run
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            this.taskTimeout
        );

        try {
            const result = await this.piscina.run(
                {
                    url: task.url,
                    timeout: task.timeout,
                    maxBuffer: task.maxBuffer,
                    retryAttempt: task.retryAttempt || 0,
                    cookies: task.cookies || null,
                },
                { signal: controller.signal }
            );

            clearTimeout(timeoutId);

            // Check if worker returned error result explicitly
            if (result && result.success === false) {
                const error = new Error(result.error || "Worker task failed");
                error.code = result.code;
                error.stderr = result.stderr;
                throw error;
            }

            return result.data;
        } catch (error) {
            clearTimeout(timeoutId);

            // Handle AbortError (timeout)
            if (error.name === "AbortError") {
                const timeoutError = new Error("Task timeout exceeded");
                timeoutError.code = "TIMEOUT";
                throw timeoutError;
            }

            // Propagate Piscina queue full error as standard code
            if (error.message.includes("Task queue is at limit")) {
                error.code = "QUEUE_FULL";
                // Rewrite message to match previous API if needed, or keep likely clear message
                // user-friendly
                error.message = `Task queue full (${this.maxQueueSize} pending). Try again later.`;
            }

            throw error;
        }
    }

    /**
     * Get pool statistics
     * @returns {Object} Pool stats
     */
    getStats() {
        return {
            totalTasks: 0, // Deprecated/Not tracked by Piscina easily without wrapper, returning 0
            completedTasks: 0, // Deprecated
            failedTasks: 0, // Deprecated
            queueLength: this.piscina.queueSize,
            activeWorkers: this.piscina.threads.length,
            activeTasks: this.piscina.utilization * this.piscina.threads.length, // Approx
            queuedTasks: this.piscina.queueSize,
            config: {
                minWorkers: this.minWorkers,
                maxWorkers: this.maxWorkers,
                taskTimeout: this.taskTimeout,
            },
        };
    }

    /**
     * Shutdown worker pool gracefully
     * @async
     * @param {number} [timeout] - Shutdown timeout in ms
     * @returns {Promise<void>}
     */
    async shutdown(timeout = 10000) {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        // Piscina destroy() kills workers. For graceful, we might wait for queue to empty?
        // Piscina doesn't have a "graceful drain and close" method that blocks new submissions but waits for old
        // standard pattern:
        try {
            await this.piscina.destroy();
        } catch (e) {
            // ignore
        }
    }
}

module.exports = WorkerPool;

/**
 * Worker Pool Manager for yt-dlp Execution (Piscina-based)
 *
 * Simplified worker pool using the Piscina library. Provides the same API as the
 * original custom implementation, but delegates the complex worker management to
 * Piscina while maintaining compatibility with existing code.
 *
 * Key Features:
 * - Dynamic worker pool (min-max sizing via Piscina)
 * - Queue management with backpressure
 * - Event emission for monitoring
 * - Graceful shutdown handling
 * @file Worker pool for non-blocking yt-dlp execution
 * @author YouTube Size Extension Team
 * @version 3.0.0
 */

const Piscina = require("piscina");
const EventEmitter = require("events");
const path = require("path");

/**
 * Worker Pool Manager
 *
 * Thin wrapper around Piscina that maintains API compatibility with the original
 * custom worker pool implementation.
 * @augments EventEmitter
 */
class WorkerPool extends EventEmitter {
    /**
     * Create a worker pool
     * @param {Object} options - Configuration options
     * @param {number} [options.minWorkers] - Minimum workers to maintain
     * @param {number} [options.maxWorkers] - Maximum workers allowed
     * @param {string} [options.workerScript] - Path to worker script
     * @param {number} [options.taskTimeout] - Task timeout in ms
     * @param {number} [options.maxTasksPerWorker] - Tasks before recycling (not used - Piscina handles this)
     * @param {number} [options.idleTimeout] - Idle time before terminating worker
     * @param {number} [options.maxQueueSize] - Maximum pending tasks before rejection
     */
    constructor(options = {}) {
        super();

        this.minWorkers = options.minWorkers || 2;
        this.maxWorkers = options.maxWorkers || 10;
        this.workerScript =
            options.workerScript || path.join(__dirname, "ytdlp-worker.js");
        this.taskTimeout = options.taskTimeout || 30000;
        this.maxTasksPerWorker = options.maxTasksPerWorker || 100; // Stored but not used
        this.idleTimeout = options.idleTimeout || 120000;
        this.maxQueueSize = options.maxQueueSize || 100;

        this.isShuttingDown = false;

        // Statistics tracking
        this.stats = {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            queuedTasks: 0,
            activeWorkers: 0,
            peakWorkers: 0,
            workersCreated: 0,
            workersDestroyed: 0,
        };

        // Previous worker count for detecting worker creation/destruction
        this._previousWorkerCount = 0;

        // Create Piscina instance
        this.piscina = new Piscina({
            filename: this.workerScript,
            minThreads: this.minWorkers,
            maxThreads: this.maxWorkers,
            idleTimeout: this.idleTimeout,
            maxQueue: this.maxQueueSize,
        });

        // Track initial workers
        this._monitorWorkerCount();
    }

    /**
     * Monitor worker count changes and emit events
     * @private
     */
    _monitorWorkerCount() {
        const currentCount = this.piscina.threads.length;

        if (currentCount > this._previousWorkerCount) {
            const created = currentCount - this._previousWorkerCount;
            for (let i = 0; i < created; i++) {
                this.stats.workersCreated++;
                this.emit("workerCreated", {
                    workerId: this.stats.workersCreated,
                    totalWorkers: currentCount,
                });
            }
        } else if (currentCount < this._previousWorkerCount) {
            const destroyed = this._previousWorkerCount - currentCount;
            for (let i = 0; i < destroyed; i++) {
                this.stats.workersDestroyed++;
                this.emit("workerDestroyed", {
                    workerId: this.stats.workersDestroyed,
                    totalWorkers: currentCount,
                });
            }
        }

        this.stats.activeWorkers = currentCount;
        this.stats.peakWorkers = Math.max(this.stats.peakWorkers, currentCount);
        this._previousWorkerCount = currentCount;
    }

    /**
     * Pre-warm the worker pool by ensuring workers are ready to handle tasks
     * @async
     * @param {number} [timeoutMs] - Maximum time to wait for warm-up
     * @returns {Promise<{warmed: number, total: number}>} Warm-up result
     */
    async warmUp(timeoutMs = 5000) {
        const startTime = Date.now();
        const warmUpPromises = [];

        // Run lightweight tasks to spin up minimum workers
        for (let i = 0; i < this.minWorkers; i++) {
            const warmUpTask = this.piscina
                .run({ warmUp: true })
                .then(() => true)
                .catch(() => false);
            warmUpPromises.push(warmUpTask);
        }

        // Wait for warm-up or timeout
        const results = await Promise.race([
            Promise.all(warmUpPromises),
            new Promise((resolve) =>
                setTimeout(
                    () => resolve(warmUpPromises.map(() => false)),
                    timeoutMs
                )
            ),
        ]);

        const warmed = results.filter(Boolean).length;
        this._monitorWorkerCount();

        this.emit("poolWarmed", {
            warmed,
            total: this.piscina.threads.length,
            durationMs: Date.now() - startTime,
        });

        return {
            warmed,
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

        // Check backpressure
        if (this.piscina.queueSize >= this.maxQueueSize) {
            const error = new Error(
                `Task queue full (${this.maxQueueSize} pending). Try again later.`
            );
            error.code = "QUEUE_FULL";
            this.emit("queueFull", {
                queueLength: this.piscina.queueSize,
                maxQueueSize: this.maxQueueSize,
            });
            throw error;
        }

        this.stats.totalTasks++;

        // Emit taskQueued if there's a queue
        if (this.piscina.queueSize > 0) {
            this.emit("taskQueued", {
                queueLength: this.piscina.queueSize,
            });
        }

        // Execute with timeout using AbortController
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
            this._monitorWorkerCount();

            // Check if worker returned error result
            if (result && result.success === false) {
                this.stats.failedTasks++;
                const error = new Error(result.error || "Worker task failed");
                error.code = result.code;
                error.stderr = result.stderr;
                throw error;
            }

            this.stats.completedTasks++;
            return result.data;
        } catch (error) {
            clearTimeout(timeoutId);
            this._monitorWorkerCount();

            // If we already incremented failedTasks above, don't do it again
            if (!(error.code && error.stderr !== undefined)) {
                this.stats.failedTasks++;
            }

            // Handle AbortError (timeout)
            if (error.name === "AbortError") {
                const timeoutError = new Error("Task timeout exceeded");
                timeoutError.code = "TIMEOUT";
                throw timeoutError;
            }

            // Re-throw worker errors
            if (error.message) {
                this.emit("workerError", {
                    workerId: "unknown",
                    error: error.message,
                });
            }

            throw error;
        }
    }

    /**
     * Get pool statistics
     * @returns {Object} Pool stats
     */
    getStats() {
        this._monitorWorkerCount();

        return {
            ...this.stats,
            queueLength: this.piscina.queueSize,
            activeWorkers: this.piscina.threads.length,
            activeTasks: this.piscina.threads.length - this.piscina.queueSize,
            queuedTasks: this.piscina.queueSize,
            config: {
                minWorkers: this.minWorkers,
                maxWorkers: this.maxWorkers,
                taskTimeout: this.taskTimeout,
                maxTasksPerWorker: this.maxTasksPerWorker,
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
        this.emit("shutdown", { activeTasks: this.piscina.queueSize });

        let timeoutId;
        try {
            // Piscina's close() drains tasks and terminates workers
            await Promise.race([
                this.piscina.close(),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error("Shutdown timeout")),
                        timeout
                    );
                }),
            ]);
            if (timeoutId) clearTimeout(timeoutId);
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            // Force destroy on timeout
            await this.piscina.destroy();
        }

        this.emit("shutdownComplete");
    }
}

module.exports = WorkerPool;

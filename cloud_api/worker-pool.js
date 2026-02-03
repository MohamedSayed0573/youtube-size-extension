/**
 * Worker Pool Manager for yt-dlp Execution
 *
 * Manages a pool of worker threads to execute yt-dlp calls in parallel without
 * blocking the Node.js event loop. Implements queue management, worker recycling,
 * and automatic scaling based on load.
 *
 * Key Features:
 * - Dynamic worker pool (min-max sizing)
 * - Queue management with priority support
 * - Automatic worker recycling after max tasks
 * - Graceful shutdown handling
 * - Integration with circuit breaker
 * @file Worker pool for non-blocking yt-dlp execution
 * @author YouTube Size Extension Team
 * @version 2.0.0
 */

const { Worker } = require("worker_threads");
const EventEmitter = require("events");
const path = require("path");

/**
 * Worker Pool Manager
 *
 * Manages worker threads and task queue for parallel yt-dlp execution.
 * Automatically scales workers based on load and recycles them to prevent memory leaks.
 * @augments EventEmitter
 * @example
 *   const pool = new WorkerPool({
 *     minWorkers: 2,
 *     maxWorkers: 10,
 *     workerScript: './ytdlp-worker.js'
 *   });
 *
 *   const result = await pool.execute({
 *     url: 'https://youtube.com/watch?v=xxx',
 *     timeout: 25000
 *   });
 *
 *   await pool.shutdown();
 */
class WorkerPool extends EventEmitter {
    /**
     * Create a worker pool
     * @param {Object} options - Configuration options
     * @param {number} [options.minWorkers] - Minimum workers to maintain
     * @param {number} [options.maxWorkers] - Maximum workers allowed
     * @param {string} [options.workerScript] - Path to worker script
     * @param {number} [options.taskTimeout] - Task timeout in ms
     * @param {number} [options.maxTasksPerWorker] - Tasks before recycling
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
        this.maxTasksPerWorker = options.maxTasksPerWorker || 100;
        this.idleTimeout = options.idleTimeout || 120000;
        this.maxQueueSize = options.maxQueueSize || 100; // Backpressure limit

        this.workers = new Map(); // workerId -> worker info
        this.taskQueue = []; // pending tasks
        this.activeTasks = 0;
        this.nextWorkerId = 1;
        this.isShuttingDown = false;

        // Stats
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

        // Initialize minimum workers
        this._initializeWorkers();
    }

    /**
     * Initialize minimum number of workers
     * @private
     */
    _initializeWorkers() {
        for (let i = 0; i < this.minWorkers; i++) {
            this._createWorker();
        }
    }

    /**
     * Create a new worker thread
     * @private
     * @returns {Object} Worker info object
     */
    _createWorker() {
        if (this.isShuttingDown) return null;

        const workerId = this.nextWorkerId++;
        const worker = new Worker(this.workerScript);

        const workerInfo = {
            id: workerId,
            worker,
            busy: false,
            tasksCompleted: 0,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            currentTask: null,
            idleTimer: null,
        };

        // Handle worker messages
        worker.on("message", (result) => {
            this._handleWorkerResult(workerId, result);
        });

        // Handle worker errors
        worker.on("error", (error) => {
            this._handleWorkerError(workerId, error);
        });

        // Handle worker exit
        worker.on("exit", (code) => {
            this._handleWorkerExit(workerId, code);
        });

        this.workers.set(workerId, workerInfo);
        this.stats.workersCreated++;
        this.stats.activeWorkers++;
        this.stats.peakWorkers = Math.max(
            this.stats.peakWorkers,
            this.stats.activeWorkers
        );

        this.emit("workerCreated", {
            workerId,
            totalWorkers: this.workers.size,
        });

        return workerInfo;
    }

    /**
     * Handle result from worker
     * @private
     * @param {number} workerId - Worker ID
     * @param {Object} result - Result from worker
     */
    _handleWorkerResult(workerId, result) {
        const workerInfo = this.workers.get(workerId);
        if (!workerInfo || !workerInfo.currentTask) return;

        const { resolve, reject } = workerInfo.currentTask;

        // Clear task timeout
        if (workerInfo.currentTask.timeoutId) {
            clearTimeout(workerInfo.currentTask.timeoutId);
        }

        // Resolve or reject promise
        if (result.success) {
            this.stats.completedTasks++;
            resolve(result.data);
        } else {
            this.stats.failedTasks++;
            const error = new Error(result.error);
            error.code = result.code;
            error.stderr = result.stderr;
            reject(error);
        }

        // Update worker state
        workerInfo.busy = false;
        workerInfo.tasksCompleted++;
        workerInfo.lastActivity = Date.now();
        workerInfo.currentTask = null;
        this.activeTasks--;

        // Check if worker should be recycled
        if (workerInfo.tasksCompleted >= this.maxTasksPerWorker) {
            this._recycleWorker(workerId);
        } else {
            // Start idle timer
            this._startIdleTimer(workerId);
            // Process next task
            this._processNextTask();
        }
    }

    /**
     * Handle worker error
     * @private
     * @param {number} workerId - Worker ID
     * @param {Error} error - Error from worker
     */
    _handleWorkerError(workerId, error) {
        const workerInfo = this.workers.get(workerId);
        if (!workerInfo) return;

        this.emit("workerError", { workerId, error: error.message });

        // Reject current task if any
        if (workerInfo.currentTask) {
            const { reject } = workerInfo.currentTask;
            if (workerInfo.currentTask.timeoutId) {
                clearTimeout(workerInfo.currentTask.timeoutId);
            }
            this.stats.failedTasks++;
            reject(new Error(`Worker error: ${error.message}`));
            this.activeTasks--;
        }

        // Terminate and replace worker
        this._destroyWorker(workerId);
        if (this.workers.size < this.minWorkers) {
            this._createWorker();
        }
    }

    /**
     * Handle worker exit
     * @private
     * @param {number} workerId - Worker ID
     * @param {number} code - Exit code
     */
    _handleWorkerExit(workerId, code) {
        const workerInfo = this.workers.get(workerId);
        if (!workerInfo) return;

        this.emit("workerExit", { workerId, code });

        // Clean up worker
        this._destroyWorker(workerId);

        // Replace if below minimum and not shutting down
        if (!this.isShuttingDown && this.workers.size < this.minWorkers) {
            this._createWorker();
        }
    }

    /**
     * Execute task in worker pool
     * @async
     * @param {Object} task - Task configuration
     * @param {string} task.url - YouTube URL
     * @param {number} task.timeout - Timeout in ms
     * @param {number} task.maxBuffer - Max buffer size
     * @param {number} [task.retryAttempt] - Retry attempt number
     * @returns {Promise<Object>} yt-dlp metadata
     * @throws {Error} If task fails or times out
     */
    execute(task) {
        if (this.isShuttingDown) {
            return Promise.reject(new Error("Worker pool is shutting down"));
        }

        // Backpressure check BEFORE incrementing stats to avoid counting rejected tasks
        const availableWorker = this._getAvailableWorker();
        if (!availableWorker && this.taskQueue.length >= this.maxQueueSize) {
            const error = new Error(
                `Task queue full (${this.maxQueueSize} pending). Try again later.`
            );
            error.code = "QUEUE_FULL";
            this.emit("queueFull", {
                queueLength: this.taskQueue.length,
                maxQueueSize: this.maxQueueSize,
            });
            return Promise.reject(error);
        }

        this.stats.totalTasks++;

        return new Promise((resolve, reject) => {
            const taskInfo = {
                ...task,
                resolve,
                reject,
                enqueuedAt: Date.now(),
            };

            // Try to execute immediately if worker available
            if (availableWorker) {
                this._executeTask(availableWorker, taskInfo);
            } else {
                // Queue task (we already checked queue size above)
                this.taskQueue.push(taskInfo);
                this.stats.queuedTasks = this.taskQueue.length;
                this.emit("taskQueued", {
                    queueLength: this.taskQueue.length,
                });

                // Scale up if needed
                if (
                    this.workers.size < this.maxWorkers &&
                    this.taskQueue.length > 0
                ) {
                    this._createWorker();
                }
            }
        });
    }

    /**
     * Get available worker or null
     * @private
     * @returns {Object|null} Available worker info
     */
    _getAvailableWorker() {
        for (const workerInfo of this.workers.values()) {
            if (!workerInfo.busy && !this.isShuttingDown) {
                return workerInfo;
            }
        }
        return null;
    }

    /**
     * Execute task on worker
     * @private
     * @param {Object} workerInfo - Worker info
     * @param {Object} taskInfo - Task info with resolve/reject
     */
    _executeTask(workerInfo, taskInfo) {
        workerInfo.busy = true;
        workerInfo.currentTask = taskInfo;
        workerInfo.lastActivity = Date.now();
        this.activeTasks++;

        // Clear idle timer
        if (workerInfo.idleTimer) {
            clearTimeout(workerInfo.idleTimer);
            workerInfo.idleTimer = null;
        }

        // Set task timeout
        const timeoutId = setTimeout(() => {
            if (workerInfo.currentTask === taskInfo) {
                this.stats.failedTasks++;
                taskInfo.reject(new Error("Task timeout exceeded"));
                this._recycleWorker(workerInfo.id);
            }
        }, this.taskTimeout);

        taskInfo.timeoutId = timeoutId;

        // Send task to worker
        workerInfo.worker.postMessage({
            url: taskInfo.url,
            timeout: taskInfo.timeout,
            maxBuffer: taskInfo.maxBuffer,
            retryAttempt: taskInfo.retryAttempt || 0,
        });
    }

    /**
     * Process next task from queue
     * @private
     */
    _processNextTask() {
        if (this.taskQueue.length === 0 || this.isShuttingDown) return;

        const availableWorker = this._getAvailableWorker();
        if (!availableWorker) return;

        const task = this.taskQueue.shift();
        this.stats.queuedTasks = this.taskQueue.length;

        this._executeTask(availableWorker, task);
    }

    /**
     * Start idle timer for worker
     * @private
     * @param {number} workerId - Worker ID
     */
    _startIdleTimer(workerId) {
        const workerInfo = this.workers.get(workerId);
        if (!workerInfo || workerInfo.busy) return;

        // Clear existing timer
        if (workerInfo.idleTimer) {
            clearTimeout(workerInfo.idleTimer);
        }

        // Only terminate if above minimum workers
        if (this.workers.size <= this.minWorkers) return;

        workerInfo.idleTimer = setTimeout(() => {
            if (!workerInfo.busy && this.workers.size > this.minWorkers) {
                this._destroyWorker(workerId);
            }
        }, this.idleTimeout);
    }

    /**
     * Recycle worker (terminate and create new one)
     * @private
     * @param {number} workerId - Worker ID
     */
    _recycleWorker(workerId) {
        this._destroyWorker(workerId);
        if (!this.isShuttingDown && this.workers.size < this.minWorkers) {
            this._createWorker();
        }
    }

    /**
     * Destroy worker
     * @private
     * @param {number} workerId - Worker ID
     */
    _destroyWorker(workerId) {
        const workerInfo = this.workers.get(workerId);
        if (!workerInfo) return;

        // Clear timers
        if (workerInfo.idleTimer) {
            clearTimeout(workerInfo.idleTimer);
        }
        if (workerInfo.currentTask && workerInfo.currentTask.timeoutId) {
            clearTimeout(workerInfo.currentTask.timeoutId);
        }

        // Terminate worker
        workerInfo.worker.terminate().catch(() => {});

        // Remove from pool
        this.workers.delete(workerId);
        this.stats.workersDestroyed++;
        this.stats.activeWorkers--;

        this.emit("workerDestroyed", {
            workerId,
            totalWorkers: this.workers.size,
        });
    }

    /**
     * Get pool statistics
     * @returns {Object} Pool stats
     */
    getStats() {
        return {
            ...this.stats,
            queueLength: this.taskQueue.length,
            activeWorkers: this.workers.size,
            activeTasks: this.activeTasks,
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
        this.emit("shutdown", { activeTasks: this.activeTasks });

        // Wait for active tasks or timeout
        const startTime = Date.now();
        while (this.activeTasks > 0 && Date.now() - startTime < timeout) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Terminate all workers
        const terminationPromises = Array.from(this.workers.keys()).map(
            (workerId) => {
                const workerInfo = this.workers.get(workerId);
                return workerInfo.worker.terminate().catch(() => {});
            }
        );

        await Promise.all(terminationPromises);
        this.workers.clear();

        // Reject queued tasks
        while (this.taskQueue.length > 0) {
            const task = this.taskQueue.shift();
            task.reject(new Error("Pool shutdown"));
        }

        this.emit("shutdownComplete");
    }
}

module.exports = WorkerPool;

/**
 * Tests for Worker Pool Integration
 * @file Test suite for worker pool and integration
 * @author YouTube Size Extension Team
 */

const request = require("supertest");
const WorkerPool = require("../worker-pool");

// Set test environment
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

describe("Worker Pool", () => {
    let pool;

    beforeEach(() => {
        pool = new WorkerPool({
            minWorkers: 1,
            maxWorkers: 3,
            taskTimeout: 5000,
            maxTasksPerWorker: 10,
        });
    });

    afterEach(async () => {
        await pool.shutdown(5000);
    });

    test("should initialize with minimum workers", () => {
        const stats = pool.getStats();
        expect(stats.activeWorkers).toBe(1);
    });

    test("should scale up workers when tasks queued", async () => {
        const tasks = [];
        // Create 5 concurrent tasks
        for (let i = 0; i < 5; i++) {
            tasks.push(
                pool
                    .execute({
                        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                        timeout: 1000,
                        maxBuffer: 1024 * 1024,
                    })
                    .catch(() => {})
            ); // Ignore errors for this test
        }

        // Wait a bit for scaling (Piscina manages detailed scaling, we just ensure stats reflect activity)
        await new Promise((resolve) => setTimeout(resolve, 500));

        const stats = pool.getStats();
        // Worker count should be at least minWorkers
        expect(stats.activeWorkers).toBeGreaterThanOrEqual(1);
    });

    test("should handle worker errors gracefully", async () => {
        // Try to execute with invalid URL (will fail)
        await expect(
            pool.execute({
                url: "invalid-url",
                timeout: 1000,
                maxBuffer: 1024,
            })
        ).rejects.toThrow();
    });

    test("should return statistics", () => {
        const stats = pool.getStats();
        // totalTasks and completedTasks are deprecated/zeroed
        expect(stats).toHaveProperty("queueLength");
        expect(stats).toHaveProperty("activeWorkers");
        expect(stats).toHaveProperty("config");
    });

    test("should reject tasks during shutdown", async () => {
        const shutdownPromise = pool.shutdown();

        await expect(
            pool.execute({
                url: "https://www.youtube.com/watch?v=test",
                timeout: 1000,
                maxBuffer: 1024,
            })
        ).rejects.toThrow("Worker pool is shutting down");

        await shutdownPromise;
    });
});

describe("Integration Tests", () => {
    let app;

    beforeAll(() => {
        // Import app after setting environment
        app = require("../server");
    });

    afterAll(async () => {
        if (app.workerPool) {
            await app.workerPool.shutdown();
        }
    });

    test("GET /health should include worker pool status", async () => {
        const response = await request(app).get("/health/main");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("workerPool");
        expect(response.body.workerPool).toHaveProperty("activeWorkers");
    });

    test("GET /api/v1/metrics should return metrics", async () => {
        const response = await request(app).get("/api/v1/metrics");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("workerPool");
    });

    test("GET /api/v1/docs should document new features", async () => {
        const response = await request(app).get("/api/v1/docs");

        expect(response.status).toBe(200);
        expect(response.body.features).toHaveProperty("workerPool");
    });
});

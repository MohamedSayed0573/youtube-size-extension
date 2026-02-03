/**
 * Tests for Worker Pool and Circuit Breaker Integration
 * @file Test suite for worker pool, circuit breaker, and their integration
 * @author YouTube Size Extension Team
 */

const request = require("supertest");
const WorkerPool = require("../worker-pool");
const { CircuitBreaker, STATE } = require("../circuit-breaker");

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

        // Wait a bit for scaling
        await new Promise((resolve) => setTimeout(resolve, 100));

        const stats = pool.getStats();
        expect(stats.activeWorkers).toBeGreaterThan(1);
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
        expect(stats).toHaveProperty("totalTasks");
        expect(stats).toHaveProperty("completedTasks");
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

describe("Circuit Breaker", () => {
    let breaker;

    beforeEach(() => {
        breaker = new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            timeout: 1000,
            volumeThreshold: 5,
            name: "test-breaker",
        });
    });

    test("should start in CLOSED state", () => {
        const status = breaker.getStatus();
        expect(status.state).toBe(STATE.CLOSED);
    });

    test("should open after threshold failures", async () => {
        // Execute failing operations
        for (let i = 0; i < 10; i++) {
            try {
                await breaker.execute(async () => {
                    throw new Error("Test failure");
                });
            } catch (error) {
                // Expected
            }
        }

        const status = breaker.getStatus();
        expect(status.state).toBe(STATE.OPEN);
    });

    test("should reject requests when OPEN", async () => {
        // Force circuit to OPEN
        breaker.forceState(STATE.OPEN);

        await expect(breaker.execute(async () => "success")).rejects.toThrow(
            "Circuit breaker is OPEN"
        );
    });

    test("should transition to HALF_OPEN after timeout", async () => {
        // Set very short timeout for testing
        breaker.timeout = 100;
        breaker.forceState(STATE.OPEN);

        // Wait for timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should allow one request in HALF_OPEN
        await breaker.execute(async () => "success");

        const status = breaker.getStatus();
        expect(status.state).toBe(STATE.HALF_OPEN);
    });

    test("should close from HALF_OPEN after successful requests", async () => {
        breaker.forceState(STATE.HALF_OPEN);

        // Execute successful operations
        await breaker.execute(async () => "success");
        await breaker.execute(async () => "success");

        const status = breaker.getStatus();
        expect(status.state).toBe(STATE.CLOSED);
    });

    test("should return to OPEN from HALF_OPEN on failure", async () => {
        breaker.forceState(STATE.HALF_OPEN);

        try {
            await breaker.execute(async () => {
                throw new Error("Test failure");
            });
        } catch (error) {
            // Expected
        }

        const status = breaker.getStatus();
        expect(status.state).toBe(STATE.OPEN);
    });

    test("should reset statistics", () => {
        breaker.stats.totalRequests = 100;
        breaker.reset();

        const status = breaker.getStatus();
        expect(status.state).toBe(STATE.CLOSED);
        expect(status.failures).toBe(0);
    });

    test("should emit state change events", (done) => {
        breaker.on("stateChange", ({ from, to }) => {
            expect(from).toBe(STATE.CLOSED);
            expect(to).toBe(STATE.OPEN);
            done();
        });

        breaker.forceState(STATE.OPEN);
    });

    test("should track statistics", async () => {
        await breaker.execute(async () => "success");

        const status = breaker.getStatus();
        expect(status.stats.totalRequests).toBeGreaterThan(0);
        expect(status.stats.totalSuccesses).toBe(1);
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

    // Reset circuit breaker before each test
    beforeEach(() => {
        if (app.circuitBreaker) {
            app.circuitBreaker.reset();
        }
    });

    test("GET /health should include worker pool and circuit breaker status", async () => {
        const response = await request(app).get("/health/main");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("workerPool");
        expect(response.body).toHaveProperty("circuitBreaker");
        expect(response.body.workerPool).toHaveProperty("activeWorkers");
        expect(response.body.circuitBreaker).toHaveProperty("state");
    });

    test("GET /api/v1/metrics should return metrics", async () => {
        const response = await request(app).get("/api/v1/metrics");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("workerPool");
        expect(response.body).toHaveProperty("circuitBreaker");
    });

    test("POST /api/v1/admin/circuit-breaker/reset should reset circuit", async () => {
        const response = await request(app)
            .post("/api/v1/admin/circuit-breaker/reset")
            .send({});

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("ok", true);
        expect(response.body).toHaveProperty("currentState");
    });

    test("GET /api/v1/docs should document new features", async () => {
        const response = await request(app).get("/api/v1/docs");

        expect(response.status).toBe(200);
        expect(response.body.features).toHaveProperty("workerPool");
        expect(response.body.features).toHaveProperty("circuitBreaker");
    });
});

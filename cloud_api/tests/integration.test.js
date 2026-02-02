/**
 * Integration Tests for Cloud API
 *
 * Tests complete workflows including:
 * - End-to-end API flows
 * - Redis integration (when enabled)
 * - Worker pool behavior under load
 * - Circuit breaker integration
 * - Graceful shutdown scenarios
 */

const request = require("supertest");
const redis = require("redis");

// Mock environment for testing
process.env.NODE_ENV = "test";
process.env.PORT = "3002";
process.env.REQUIRE_AUTH = "false";
process.env.ALLOWED_ORIGINS = "*";
process.env.RATE_LIMIT_WINDOW_MS = "5000"; // 5 seconds for faster tests
process.env.RATE_LIMIT_MAX_REQUESTS = "5";
process.env.MIN_WORKERS = "2";
process.env.MAX_WORKERS = "4";

// Redis setup (will skip tests if Redis not available)
let redisClient = null;
let redisAvailable = false;

beforeAll(async () => {
    // Try to connect to Redis for distributed rate limiting tests
    if (process.env.REDIS_URL) {
        try {
            redisClient = redis.createClient({ url: process.env.REDIS_URL });
            await redisClient.connect();
            await redisClient.ping();
            redisAvailable = true;
            console.log("✓ Redis available for integration tests");
        } catch (error) {
            console.log("⚠ Redis not available, skipping Redis tests");
            redisAvailable = false;
        }
    }
});

afterAll(async () => {
    if (redisClient) {
        await redisClient.quit();
    }
});

// Import app after environment setup
const app = require("../server.js");

describe("Integration Tests", () => {
    describe("End-to-End API Workflow", () => {
        test("should successfully extract video size information", async () => {
            const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; // "Me at the zoo"

            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: testUrl })
                .expect(200);

            expect(response.body).toHaveProperty("ok", true);
            expect(response.body).toHaveProperty("bytes");
            expect(response.body).toHaveProperty("human");
            expect(response.body).toHaveProperty("duration");

            // Verify bytes structure
            expect(typeof response.body.bytes).toBe("object");
            expect(Object.keys(response.body.bytes).length).toBeGreaterThan(0);

            // Verify human-readable format
            expect(typeof response.body.human).toBe("object");
            Object.values(response.body.human).forEach((value) => {
                expect(value).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/);
            });

            // Verify duration is positive
            expect(response.body.duration).toBeGreaterThan(0);
        }, 30000); // 30 second timeout

        test("should handle duration hint optimization", async () => {
            const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
            const durationHint = 19; // "Me at the zoo" is 19 seconds

            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: testUrl, duration_hint: durationHint })
                .expect(200);

            expect(response.body).toHaveProperty("ok", true);
            expect(response.body.duration).toBeCloseTo(durationHint, 0);
        }, 30000);

        test("should handle invalid YouTube URL gracefully", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "https://www.youtube.com/watch?v=INVALID" })
                .expect(500);

            expect(response.body).toHaveProperty("ok", false);
            expect(response.body).toHaveProperty("error");
            expect(response.body).toHaveProperty("requestId");
        }, 30000);
    });

    describe("Redis Integration", () => {
        beforeEach(async () => {
            // Clear rate limit keys before each test
            if (redisAvailable && redisClient) {
                const keys = await redisClient.keys("rl:*");
                if (keys.length > 0) {
                    await redisClient.del(keys);
                }
            }
        });

        test("should report Redis status in health endpoint", async () => {
            const response = await request(app).get("/health").expect(200);

            expect(response.body.dependencies).toHaveProperty("redis");
            expect(response.body.dependencies.redis).toHaveProperty("enabled");

            if (redisAvailable) {
                expect(response.body.dependencies.redis.connected).toBe(true);
            }
        });

        test("GET /health/redis should check Redis connectivity", async () => {
            const response = await request(app).get("/health/redis");

            if (redisAvailable) {
                expect(response.status).toBe(200);
                expect(response.body).toHaveProperty("ok", true);
                expect(response.body).toHaveProperty("redis", "connected");
                expect(response.body).toHaveProperty("latency");
            } else if (process.env.REDIS_ENABLED === "true") {
                expect(response.status).toBe(503);
                expect(response.body).toHaveProperty("ok", false);
            } else {
                expect(response.status).toBe(200);
                expect(response.body.redis).toBe("disabled");
            }
        });

        (redisAvailable ? test : test.skip)(
            "should enforce rate limits across multiple requests (Redis)",
            async () => {
                const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
                const maxRequests = 5;
                const requests = [];

                // Make more requests than the limit
                for (let i = 0; i < maxRequests + 3; i++) {
                    requests.push(
                        request(app)
                            .post("/api/v1/size")
                            .send({ url: testUrl })
                    );
                }

                const responses = await Promise.all(requests);

                // Count successful and rate-limited responses
                const successful = responses.filter((r) => r.status === 200);
                const rateLimited = responses.filter((r) => r.status === 429);

                expect(successful.length).toBeLessThanOrEqual(maxRequests + 2); // Allow burst
                expect(rateLimited.length).toBeGreaterThan(0);

                // Verify rate limit response format
                const limitedResponse = rateLimited[0];
                expect(limitedResponse.body).toHaveProperty("ok", false);
                expect(limitedResponse.body).toHaveProperty("error");
                expect(limitedResponse.body.error).toContain("Too many requests");
            },
            35000
        );
    });

    describe("Worker Pool Behavior", () => {
        test("should handle concurrent requests without blocking", async () => {
            const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
            const concurrentRequests = 3;

            const startTime = Date.now();
            const requests = Array(concurrentRequests)
                .fill()
                .map(() =>
                    request(app)
                        .post("/api/v1/size")
                        .send({ url: testUrl })
                );

            const responses = await Promise.all(requests);
            const duration = Date.now() - startTime;

            // All should succeed
            responses.forEach((response) => {
                expect(response.status).toBe(200);
                expect(response.body).toHaveProperty("ok", true);
            });

            // Should complete faster than sequential execution
            // Sequential would take ~15-20s (3 * 5s avg), parallel should be ~5-10s
            expect(duration).toBeLessThan(15000);
        }, 20000);

        test("should track worker pool metrics", async () => {
            const response = await request(app).get("/api/v1/metrics");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("workerPool");
            expect(response.body.workerPool).toHaveProperty("totalWorkers");
            expect(response.body.workerPool).toHaveProperty("activeWorkers");
            expect(response.body.workerPool).toHaveProperty("queueLength");
            expect(response.body.workerPool).toHaveProperty("tasksCompleted");
            expect(response.body.workerPool).toHaveProperty("tasksErrored");

            // Verify worker pool is operational
            expect(response.body.workerPool.totalWorkers).toBeGreaterThan(0);
            expect(response.body.workerPool.totalWorkers).toBeLessThanOrEqual(
                4
            ); // MAX_WORKERS
        });
    });

    describe("Circuit Breaker Integration", () => {
        test("should track circuit breaker state", async () => {
            const response = await request(app).get("/api/v1/metrics");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("circuitBreaker");
            expect(response.body.circuitBreaker).toHaveProperty("state");
            expect(["CLOSED", "OPEN", "HALF_OPEN"]).toContain(
                response.body.circuitBreaker.state
            );
            expect(response.body.circuitBreaker).toHaveProperty("failureCount");
            expect(response.body.circuitBreaker).toHaveProperty("successCount");
        });

        test("should reset circuit breaker via admin endpoint", async () => {
            // Enable auth for this test
            process.env.REQUIRE_AUTH = "true";
            process.env.API_KEY = "test-key";

            const response = await request(app)
                .post("/api/v1/admin/circuit-breaker/reset")
                .set("X-API-Key", "test-key")
                .expect(200);

            expect(response.body).toHaveProperty("ok", true);
            expect(response.body).toHaveProperty("message");

            // Reset auth for other tests
            process.env.REQUIRE_AUTH = "false";
        });

        test("should protect admin endpoint with authentication", async () => {
            process.env.REQUIRE_AUTH = "true";
            process.env.API_KEY = "test-key";

            // Without API key
            const response1 = await request(app)
                .post("/api/v1/admin/circuit-breaker/reset")
                .expect(401);

            expect(response1.body).toHaveProperty("ok", false);
            expect(response1.body).toHaveProperty("error");

            // With wrong API key
            const response2 = await request(app)
                .post("/api/v1/admin/circuit-breaker/reset")
                .set("X-API-Key", "wrong-key")
                .expect(401);

            expect(response2.body).toHaveProperty("ok", false);

            // Reset auth
            process.env.REQUIRE_AUTH = "false";
        });
    });

    describe("Error Handling and Logging", () => {
        test("should return structured error responses", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "not-a-youtube-url" })
                .expect(400);

            expect(response.body).toHaveProperty("ok", false);
            expect(response.body).toHaveProperty("error");
            expect(response.body).toHaveProperty("requestId");
            expect(response.body.error).toContain("YouTube");
        });

        test("should handle malformed JSON gracefully", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .set("Content-Type", "application/json")
                .send("invalid json{")
                .expect(400);

            expect(response.body).toHaveProperty("ok", false);
        });

        test("should handle large payloads gracefully", async () => {
            const largePayload = {
                url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
                extra: "a".repeat(20000), // 20KB extra data
            };

            const response = await request(app)
                .post("/api/v1/size")
                .send(largePayload)
                .expect(413); // Payload Too Large

            expect(response.body).toHaveProperty("ok", false);
        });
    });

    describe("CORS and Security Headers", () => {
        test("should include CORS headers", async () => {
            const response = await request(app).get("/");

            expect(response.headers).toHaveProperty(
                "access-control-allow-origin"
            );
        });

        test("should handle OPTIONS preflight requests", async () => {
            const response = await request(app)
                .options("/api/v1/size")
                .set("Origin", "https://example.com")
                .set("Access-Control-Request-Method", "POST")
                .expect(204);

            expect(response.headers).toHaveProperty(
                "access-control-allow-methods"
            );
            expect(response.headers).toHaveProperty(
                "access-control-allow-headers"
            );
        });

        test("should include security headers", async () => {
            const response = await request(app).get("/");

            // These might be set by nginx in production, but good to test
            expect(response.headers).toHaveProperty("x-request-id");
        });
    });

    describe("OpenAPI Specification", () => {
        test("GET /api/v1/openapi should return valid OpenAPI spec", async () => {
            const response = await request(app)
                .get("/api/v1/openapi")
                .expect(200);

            expect(response.body).toHaveProperty("openapi");
            expect(response.body.openapi).toMatch(/^3\.0\./);
            expect(response.body).toHaveProperty("info");
            expect(response.body).toHaveProperty("paths");
            expect(response.body).toHaveProperty("components");

            // Verify key endpoints are documented
            expect(response.body.paths).toHaveProperty("/api/v1/size");
            expect(response.body.paths).toHaveProperty("/health");
        });
    });
});

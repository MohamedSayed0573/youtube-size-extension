/**
 * Cloud API Server Tests
 *
 * Test suite for the ytdlp-sizer-api server
 * Tests endpoints, validation, error handling, and security features
 */

const request = require("supertest");

// Mock environment for testing
process.env.NODE_ENV = "test";
process.env.PORT = "3001";
process.env.REQUIRE_AUTH = "false";
process.env.ALLOWED_ORIGINS = "*";
process.env.RATE_LIMIT_WINDOW_MS = "60000";
process.env.RATE_LIMIT_MAX_REQUESTS = "100"; // High limit for tests

// Import app after setting environment
const app = require("../server.js");

describe("Cloud API Server", () => {
    describe("Health Endpoints", () => {
        test("GET / should return service info", async () => {
            const response = await request(app).get("/");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("ok", true);
            expect(response.body).toHaveProperty("service", "ytdlp-sizer-api");
            expect(response.body).toHaveProperty("version");
            expect(response.body).toHaveProperty("status", "running");
        });

        test("GET /health should return health metrics", async () => {
            const response = await request(app).get("/health");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("ok", true);
            expect(response.body).toHaveProperty("status");
            expect(["healthy", "degraded"]).toContain(response.body.status);
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body).toHaveProperty("system");
            expect(response.body).toHaveProperty("dependencies");
            expect(response.body.dependencies).toHaveProperty("ytdlp");
            expect(response.body.dependencies.ytdlp).toHaveProperty(
                "available"
            );
            expect(response.body.dependencies.ytdlp).toHaveProperty("version");
        });

        test("GET /api/v1/docs should return API documentation", async () => {
            const response = await request(app).get("/api/v1/docs");

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("version", "v1");
            expect(response.body).toHaveProperty("service", "ytdlp-sizer-api");
            expect(response.body).toHaveProperty("endpoints");
            expect(response.body).toHaveProperty("features");
            expect(response.body.features).toHaveProperty("requestTracing");
            expect(response.body.features).toHaveProperty("retryLogic");
        });
    });

    describe("Request Tracing", () => {
        test("should generate X-Request-ID if not provided", async () => {
            const response = await request(app).get("/");

            expect(response.headers).toHaveProperty("x-request-id");
            expect(response.headers["x-request-id"]).toMatch(/^req_/);
        });

        test("should preserve X-Request-ID from client", async () => {
            const customId = "test-trace-123";
            const response = await request(app)
                .get("/")
                .set("X-Request-ID", customId);

            expect(response.headers["x-request-id"]).toBe(customId);
        });

        test("should include request ID in error responses", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "invalid" });

            expect(response.body).toHaveProperty("requestId");
            expect(response.headers).toHaveProperty("x-request-id");
            expect(response.body.requestId).toBe(
                response.headers["x-request-id"]
            );
        });
    });

    describe("API v1 Endpoints", () => {
        describe("POST /api/v1/size", () => {
            test("should reject missing URL", async () => {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({});

                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body.error).toMatch(/url.*required/i);
            });

            test("should reject invalid YouTube URL", async () => {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({ url: "https://example.com/not-youtube" });

                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body.error).toMatch(/invalid.*youtube/i);
            });

            test("should reject URL with command injection attempt", async () => {
                const maliciousUrls = [
                    "https://youtube.com/watch?v=xxx; rm -rf /",
                    "https://youtube.com/watch?v=xxx$(whoami)",
                    "https://youtube.com/watch?v=xxx`id`",
                    "https://youtube.com/watch?v=xxx|cat /etc/passwd",
                ];

                for (const url of maliciousUrls) {
                    const response = await request(app)
                        .post("/api/v1/size")
                        .send({ url });

                    expect(response.status).toBe(400);
                    expect(response.body).toHaveProperty("ok", false);
                }
            });

            test("should reject invalid duration_hint", async () => {
                const response = await request(app).post("/api/v1/size").send({
                    url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
                    duration_hint: "invalid",
                });

                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
                expect(response.body.error).toMatch(/duration_hint/i);
            });

            test("should reject duration_hint outside valid range", async () => {
                const response = await request(app).post("/api/v1/size").send({
                    url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
                    duration_hint: 99999,
                });

                expect(response.status).toBe(400);
                expect(response.body).toHaveProperty("ok", false);
            });

            test("should accept valid YouTube watch URL", async () => {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" });

                // Will fail with 502/504 if yt-dlp not available or video not found
                // but should not be a validation error (400)
                expect(response.status).not.toBe(400);
            });

            test("should accept valid youtu.be URL", async () => {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({ url: "https://youtu.be/dQw4w9WgXcQ" });

                expect(response.status).not.toBe(400);
            });

            test("should accept valid YouTube shorts URL", async () => {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({ url: "https://youtube.com/shorts/abc123def45" });

                expect(response.status).not.toBe(400);
            });
        });
    });

    describe("Security Features", () => {
        test("should block URLs with shell metacharacters", async () => {
            const dangerousChars = [
                ";",
                "|",
                "&",
                "`",
                "$",
                "(",
                ")",
                "<",
                ">",
            ];

            for (const char of dangerousChars) {
                const response = await request(app)
                    .post("/api/v1/size")
                    .send({
                        url: `https://youtube.com/watch?v=test${char}malicious`,
                    });

                expect(response.status).toBe(400);
                expect(response.body.ok).toBe(false);
            }
        });

        test("should reject non-HTTPS URLs", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "http://youtube.com/watch?v=dQw4w9WgXcQ" });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

        test("should reject file:// protocol", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "file:///etc/passwd" });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

        test("should reject path traversal attempts", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: "https://youtube.com/../../etc/passwd" });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

        test("should enforce Content-Type JSON", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .set("Content-Type", "text/plain")
                .send("url=test");

            expect(response.status).toBe(400);
        });
    });

    describe("Error Handling", () => {
        test("should return 404 for unknown routes", async () => {
            const response = await request(app).get("/api/v1/nonexistent");

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty("ok", false);
            expect(response.body).toHaveProperty("error");
            expect(response.body).toHaveProperty("availableEndpoints");
        });

        test("should handle malformed JSON", async () => {
            const response = await request(app)
                .post("/api/v1/size")
                .set("Content-Type", "application/json")
                .send("{ malformed json");

            // Express body-parser returns 400 for malformed JSON,
            // but error middleware may catch it and return 500
            expect([400, 500]).toContain(response.status);
            expect(response.body).toHaveProperty("ok", false);
        });

        test("should reject URLs exceeding length limit", async () => {
            const longUrl = "https://youtube.com/watch?v=" + "a".repeat(300);

            const response = await request(app)
                .post("/api/v1/size")
                .send({ url: longUrl });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });
    });

    describe("CORS", () => {
        test("should include CORS headers", async () => {
            const response = await request(app)
                .get("/")
                .set("Origin", "https://example.com");

            expect(response.headers).toHaveProperty(
                "access-control-allow-origin"
            );
        });

        test("should handle OPTIONS preflight", async () => {
            const response = await request(app)
                .options("/api/v1/size")
                .set("Origin", "https://example.com")
                .set("Access-Control-Request-Method", "POST");

            expect(response.status).toBe(204);
        });
    });
});

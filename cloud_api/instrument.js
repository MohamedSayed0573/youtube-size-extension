// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");
const { CONFIG } = require("./config/env");

// Use validated configuration
const config = CONFIG;

// Skip Sentry initialization in test environment
if (config.NODE_ENV !== "test" && config.SENTRY_DSN) {
    Sentry.init({
        dsn: config.SENTRY_DSN,

        // Performance Monitoring
        tracesSampleRate: config.NODE_ENV === "production" ? 0.1 : 1.0,

        // Set sampling rate for profiling - this is relative to tracesSampleRate
        profilesSampleRate: config.NODE_ENV === "production" ? 0.1 : 1.0,

        // Profiling integration
        integrations: [nodeProfilingIntegration()],

        // Environment configuration
        environment: config.NODE_ENV,

        // Setting this option to true will send default PII data to Sentry.
        // For example, automatic IP address collection on events
        sendDefaultPii: config.NODE_ENV !== "production",
    });
}

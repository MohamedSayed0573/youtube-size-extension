// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

Sentry.init({
    dsn: "https://4234c642d17f36dccb8f0deb9f954094@o4510816854343680.ingest.de.sentry.io/4510816857555024",

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Profiling integration
    integrations: [nodeProfilingIntegration()],

    // Environment configuration
    environment: process.env.NODE_ENV || "development",

    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
});

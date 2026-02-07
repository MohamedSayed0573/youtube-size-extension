/**
 * Logger configuration module
 * Provides centralized Pino logger setup for the Cloud API
 * @module config/logger
 */

const pino = require("pino");
const { CONFIG } = require("./env");

const level =
    CONFIG.LOG_LEVEL || (CONFIG.NODE_ENV === "test" ? "silent" : "info");

const loggerOptions = {
    level,
    // Only use pino-pretty in non-production, non-test environments
    transport:
        CONFIG.NODE_ENV !== "production" && CONFIG.NODE_ENV !== "test"
            ? {
                  target: "pino-pretty",
                  options: {
                      colorize: true,
                      translateTime: "SYS:standard",
                      ignore: "pid,hostname",
                  },
              }
            : undefined,
};

/**
 * Main application logger instance
 * Configured based on NODE_ENV and LOG_LEVEL from environment
 * @type {import('pino').Logger}
 * @example
 * const { logger } = require('./config/logger');
 * logger.info('Server started');
 * logger.error({ err }, 'Request failed');
 */
const logger = pino(loggerOptions);

/**
 * Worker logger instance with [Worker] prefix for yt-dlp worker threads
 * Used in ytdlp-worker.js for isolated worker thread logging
 * @type {import('pino').Logger}
 * @example
 * const { workerLogger } = require('./config/logger');
 * workerLogger.info('Executing yt-dlp command');
 */
const workerLogger = logger.child({ context: "Worker" });

module.exports = { logger, workerLogger };

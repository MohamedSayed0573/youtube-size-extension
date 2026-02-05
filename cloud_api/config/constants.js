/**
 * Configuration constants for the Cloud API
 * @module config/constants
 */

const TIMEOUTS = {
    YTDLP_DEFAULT: 25000, // 25 seconds for yt-dlp execution
    TASK_BUFFER: 5000, // 5 second buffer for worker tasks
    HEALTH_CHECK: 5000, // 5 seconds for health check
    WORKER_IDLE: 120000, // 2 minutes worker idle timeout
    SHUTDOWN_GRACE: 10000, // 10 seconds graceful shutdown
    WARMUP_WORKER_TIMEOUT: 2000, // 2 seconds for worker warm-up ping
};

const LIMITS = {
    MAX_BUFFER: 10 * 1024 * 1024, // 10 MB max buffer for yt-dlp output
    REQUEST_BODY: "10kb", // 10 KB max request body
    MIN_WORKERS: 2, // Minimum worker pool size
    MAX_WORKERS: 10, // Maximum worker pool size
    MAX_TASKS_PER_WORKER: 100, // Tasks before worker recycle
    REQUEST_ID_MAX_LENGTH: 64, // Maximum length for request IDs
};

const VIDEO_FORMAT_IDS = {
    "144p": ["394"],
    "240p": ["395"],
    "360p": ["396"],
    "480p": ["397"],
    "720p": ["398"],
    "1080p": ["399", "299", "303"],
    "1440p": ["400", "308"],
};

const AUDIO_FALLBACK_ID = "251";

module.exports = {
    TIMEOUTS,
    LIMITS,
    VIDEO_FORMAT_IDS,
    AUDIO_FALLBACK_ID,
};

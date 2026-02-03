/**
 * Shared utility functions for YouTube Size Extension
 *
 * This module provides common functionality used across multiple components:
 * - URL validation and parsing (with security hardening)
 * - Video ID extraction
 * - Data formatting (bytes, duration)
 * - Cache utilities
 * @file Shared utilities to eliminate code duplication
 * @module utils
 */

/** @constant {string} Prefix for all cache keys */
const CACHE_KEY_PREFIX = "sizeCache_";

/**
 * Generates a cache key for a video ID
 * @param {string} videoId - The YouTube video ID
 * @returns {string} The cache key (e.g., "sizeCache_dQw4w9WgXcQ")
 */
function getCacheKey(videoId) {
    return `${CACHE_KEY_PREFIX}${videoId}`;
}

/**
 * Resolution size keys used for validation
 * @constant {string[]}
 */
const SIZE_KEYS = [
    "s144p",
    "s240p",
    "s360p",
    "s480p",
    "s720p",
    "s1080p",
    "s1440p",
    "s1080p_299",
    "s1080p_303",
    "s1080p_399",
    "s1440p_308",
    "s1440p_400",
];

/**
 * Validates that cached data contains at least one valid size value
 *
 * Checks both human-readable and byte maps for any non-null values.
 * Prevents showing empty cache entries as valid data.
 * @param {Object} cached - The cached data object to validate
 * @returns {boolean} True if cache contains at least one valid size
 */
function cacheHasAnySize(cached) {
    try {
        if (!cached) return false;
        const b = cached.bytes;
        const h = cached.human;
        if (
            b &&
            SIZE_KEYS.some((k) => typeof b[k] === "number" && isFinite(b[k]))
        ) {
            return true;
        }
        if (h && SIZE_KEYS.some((k) => typeof h[k] === "string" && h[k])) {
            return true;
        }
        return false;
    } catch (e) {
        // Log but don't fail - caller will treat as false
        if (typeof Logger !== "undefined" && Logger.warn) {
            Logger.warn("cacheHasAnySize check failed", e);
        }
        return false;
    }
}

/**
 * Simple logger wrapper that only logs in development mode
 *
 * Detects development mode by checking for missing update_url in manifest
 * (typical for unpacked extensions) or if explicitly enabled.
 */
const Logger = {
    _isDev: null,

    /**
     * Check if we are in development mode
     * @returns {boolean} True if dev mode
     */
    isDev() {
        if (this._isDev !== null) return this._isDev;
        try {
            // Unpacked extensions usually don't have an update_url
            if (
                typeof chrome !== "undefined" &&
                chrome.runtime &&
                chrome.runtime.getManifest
            ) {
                const manifest = chrome.runtime.getManifest();
                this._isDev = !manifest.update_url;
            } else {
                // Fallback for non-ext environments (tests)
                this._isDev = true;
            }
        } catch (e) {
            // Fallback for non-ext environments (tests)
            this._isDev = false;
        }
        return this._isDev;
    },

    info(...args) {
        if (this.isDev()) console.log("[ytSize]", ...args);
    },

    warn(...args) {
        if (this.isDev()) console.warn("[ytSize]", ...args);
    },

    error(...args) {
        if (this.isDev()) console.error("[ytSize]", ...args);
    },
};

/**
 * Dangerous patterns that indicate potential command injection
 * @constant {RegExp[]}
 */
const DANGEROUS_URL_PATTERNS = [
    /[;&|`$(){}[\]<>\\]/, // Shell metacharacters
    /\$\(/, // Command substitution
    /`/, // Backtick execution
    /\.\.\//, // Path traversal
    /file:\/\//, // File protocol
];

/**
 * Valid YouTube hostnames
 * @constant {string[]}
 */
const VALID_YOUTUBE_HOSTS = [
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "youtu.be",
];

/**
 * Validates if a URL is a legitimate YouTube URL
 *
 * Security-hardened validation that:
 * - Checks for valid YouTube domains (youtube.com, youtu.be)
 * - Requires HTTPS protocol
 * - Blocks shell metacharacters and command injection patterns
 * - Ensures the URL contains a video identifier
 * @param {string} url - The URL to validate
 * @returns {boolean} True if the URL is a valid and safe YouTube video URL
 * @example
 *   isYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ') // true
 *   isYouTubeUrl('https://example.com') // false
 *   isYouTubeUrl('https://youtube.com/watch?v=xxx;rm -rf /') // false (blocked)
 */
function isYouTubeUrl(url) {
    try {
        if (!url || typeof url !== "string") {
            return false;
        }

        // Check length (YouTube URLs shouldn't be extremely long)
        if (url.length > 200) {
            return false;
        }

        // Block shell metacharacters and command injection patterns
        for (const pattern of DANGEROUS_URL_PATTERNS) {
            if (pattern.test(url)) {
                return false;
            }
        }

        const u = new URL(url);

        // Require HTTPS protocol for security
        if (u.protocol !== "https:") {
            return false;
        }

        // Check for valid YouTube hostname
        if (!VALID_YOUTUBE_HOSTS.includes(u.hostname)) {
            return false;
        }

        // Validate has video ID or is a valid path
        const hasVideoParam = u.searchParams.has("v");
        const isWatchPath = u.pathname.startsWith("/watch");
        const isShortsPath = /^\/shorts\/[\w-]+$/.test(u.pathname);
        const isShortUrl = u.hostname === "youtu.be";

        return hasVideoParam || isWatchPath || isShortsPath || isShortUrl;
    } catch (error) {
        // TypeError is expected for malformed URLs - return false
        if (error instanceof TypeError) {
            return false;
        }
        // Re-throw unexpected errors (RangeError, system errors, etc.)
        throw error;
    }
}

/**
 * Extracts the video ID from various YouTube URL formats
 *
 * Handles multiple URL formats:
 * - Standard watch URLs: /watch?v=VIDEO_ID
 * - Short URLs: youtu.be/VIDEO_ID
 * - Shorts URLs: /shorts/VIDEO_ID
 * @param {string} url - The YouTube URL to parse
 * @returns {string|null} The video ID (11-character string) or null if not found
 * @example
 *   extractVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 *   extractVideoId('https://youtu.be/dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 *   extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 */
function extractVideoId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes("youtu.be")) {
            const id = u.pathname.replace(/^\//, "").split("/")[0];
            return id || null;
        }
        if (u.searchParams.has("v")) return u.searchParams.get("v");
        const m = u.pathname.match(/\/shorts\/([\w-]{5,})/);
        if (m) return m[1];
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Converts bytes to human-readable format using decimal (SI) units
 *
 * Uses 1000-based (decimal) units: KB, MB, GB, TB.
 * This matches how storage is typically advertised and displayed.
 * @param {number} n - Number of bytes
 * @returns {string|null} Formatted string (e.g., "45.32 MB") or null if invalid
 * @example
 *   humanizeBytes(1500) // "1.50 KB"
 *   humanizeBytes(1048576) // "1.05 MB"
 *   humanizeBytes(null) // null
 */
function humanizeBytes(n) {
    if (n == null || !isFinite(n)) return null;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = Number(n);
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
        v /= 1000;
        i++;
    }
    if (i === 0) return `${Math.trunc(v)} ${units[i]}`;
    return `${v.toFixed(2)} ${units[i]}`;
}

/**
 * Converts seconds to human-readable duration format
 *
 * Formats as:
 * - M:SS for durations under 1 hour
 * - H:MM:SS for durations 1 hour or longer
 * @param {number} seconds - Duration in seconds
 * @returns {string|null} Formatted duration string or null if invalid
 * @example
 *   humanizeDuration(90) // "1:30"
 *   humanizeDuration(3665) // "1:01:05"
 *   humanizeDuration(null) // null
 */
function humanizeDuration(seconds) {
    if (seconds == null || !isFinite(seconds) || seconds <= 0) return null;
    try {
        const s = Math.round(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
        }
        return `${m}:${String(sec).padStart(2, "0")}`;
    } catch (e) {
        return null;
    }
}

// Export for use in other modules (browser extension context)
/* eslint-disable no-undef */
if (typeof module !== "undefined" && module.exports) {
    // Node.js/CommonJS environment
    module.exports = {
        CACHE_KEY_PREFIX,
        getCacheKey,
        cacheHasAnySize,
        SIZE_KEYS,
        isYouTubeUrl,
        extractVideoId,
        humanizeBytes,
        humanizeDuration,
        Logger,
        DANGEROUS_URL_PATTERNS,
        VALID_YOUTUBE_HOSTS,
    };
}

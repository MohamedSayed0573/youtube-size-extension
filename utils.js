/**
 * Shared utility functions for YouTube Size Extension
 *
 * This module provides common functionality used across multiple components:
 * - URL validation and parsing
 * - Video ID extraction
 * - Data formatting (bytes, duration)
 * @file Shared utilities to eliminate code duplication
 * @module utils
 */

/**
 * Validates if a URL is a legitimate YouTube URL
 *
 * Checks for valid YouTube domains (youtube.com, youtu.be) and ensures
 * the URL contains a video identifier (v param, /watch path, or /shorts path).
 * @param {string} url - The URL to validate
 * @returns {boolean} True if the URL is a valid YouTube video URL
 * @example
 *   isYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ') // true
 *   isYouTubeUrl('https://example.com') // false
 */
function isYouTubeUrl(url) {
    try {
        const u = new URL(url);
        return (
            (u.host.includes("youtube.com") || u.host.includes("youtu.be")) &&
            (u.searchParams.has("v") ||
                u.pathname.startsWith("/watch") ||
                u.host.includes("youtu.be") ||
                /\/shorts\//.test(u.pathname))
        );
    } catch (_) {
        return false;
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
    } catch (_) {
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
    if (!seconds || seconds <= 0) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// Export for use in other modules (browser extension context)
/* eslint-disable no-undef */
if (typeof module !== "undefined" && module.exports) {
    // Node.js/CommonJS environment
    module.exports = {
        isYouTubeUrl,
        extractVideoId,
        humanizeBytes,
        humanizeDuration,
    };
}

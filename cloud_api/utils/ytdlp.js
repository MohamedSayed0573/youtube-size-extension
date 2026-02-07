/**
 * Utility functions for video size extraction
 * @module utils/ytdlp
 */

const Sentry = require("@sentry/node");
const { VIDEO_FORMAT_IDS, AUDIO_FALLBACK_ID } = require("../config/constants");
const { CONFIG } = require("../config/env");
const { logger } = require("../config/logger");
const { humanizeBytes, humanizeDuration, formatUptime } = require("./format");

/**
 * Validates that a URL is a legitimate YouTube URL
 *
 * Prevents command injection by ensuring only valid YouTube URLs are processed.
 * Blocks any URL with shell metacharacters or suspicious patterns.
 * Note: A matching validation exists in the extension's utils.js for the client-side.
 * @param {string} url - The URL to validate
 * @returns {boolean} True if URL is valid and safe
 */

const DANGEROUS_URL_PATTERNS = [
    /[;|`$(){}[\]<>\\]/, // Shell metacharacters (& is allowed - it's a valid URL query separator)
    /\.\.\//, // Path traversal
    /file:\/\//, // File protocol (defense-in-depth; also blocked by protocol check)
];

const VALID_YOUTUBE_HOSTS = [
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
];

function isValidYouTubeUrl(url) {
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

    // Validate it's actually a YouTube URL
    try {
        const parsedUrl = new URL(url);

        if (!VALID_YOUTUBE_HOSTS.includes(parsedUrl.hostname)) {
            return false;
        }

        // Must use https protocol
        if (parsedUrl.protocol !== "https:") {
            return false;
        }

        // Validate has video ID or is a valid path
        const hasVideoParam = parsedUrl.searchParams.has("v");
        const isValidPath =
            parsedUrl.pathname.startsWith("/watch") ||
            parsedUrl.pathname.match(/^\/shorts\/[\w-]+$/) ||
            parsedUrl.hostname === "youtu.be";

        return hasVideoParam || isValidPath;
    } catch (error) {
        return false;
    }
}

/**
 * Calculates file size from a yt-dlp format object
 *
 * Prefers exact filesize, falls back to filesize_approx, then estimates
 * from bitrate (tbr) and duration.
 * @param {Object} fmt - The format object from yt-dlp JSON output
 * @param {number} durationSec - Video duration in seconds
 * @returns {number|null} Estimated size in bytes or null
 */
function sizeFromFormat(fmt, durationSec) {
    if (!fmt) return null;

    // Pick first non-null, positive value
    const fs =
        (fmt.filesize != null && fmt.filesize > 0 ? fmt.filesize : null) ||
        (fmt.filesize_approx != null && fmt.filesize_approx > 0
            ? fmt.filesize_approx
            : null);
    if (fs) return Math.round(fs);

    // Estimate from TBR if filesize missing
    try {
        const tbr = fmt.tbr; // in kbps
        if (tbr && durationSec && durationSec > 0) {
            return Math.round(((tbr * 1000.0) / 8.0) * durationSec);
        }
    } catch (e) {
        // ignore
    }
    return null;
}

/**
 * Extracts video metadata from YouTube using yt-dlp with retry logic
 *
 * Uses worker pool for non-blocking execution.
 * @async
 * @param {string} url - The YouTube video URL (must be validated first)
 * @param {Object} workerPool - Worker pool instance
 * @param {number} [maxRetries] - Maximum number of retry attempts
 * @param {string|null} [cookies] - Optional cookies in Netscape format for authentication
 * @returns {Promise<Object>} Parsed JSON metadata from yt-dlp
 * @throws {Error} If yt-dlp fails after all retries
 */
async function extractInfo(url, workerPool, maxRetries = 2, cookies = null) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const data = await workerPool.execute({
                url,
                timeout: CONFIG.YTDLP_TIMEOUT,
                maxBuffer: CONFIG.YTDLP_MAX_BUFFER,
                retryAttempt: attempt,
                cookies, // Pass cookies for YouTube authentication
            });

            return data;
        } catch (error) {
            lastError = error;

            // Don't retry on timeout or critical errors
            const noRetryErrors = ["TIMEOUT", "NOT_FOUND", "VIDEO_UNAVAILABLE"];
            if (noRetryErrors.includes(error.code)) {
                break;
            }

            // Don't retry on final attempt
            if (attempt < maxRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
                logger.warn(
                    {
                        attempt,
                        backoffMs,
                        error: error.message,
                        code: error.code,
                    },
                    "Retrying yt-dlp after failure"
                );
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }
    }

    // All retries exhausted - format error message
    logger.error(
        {
            url,
            attempts: maxRetries + 1,
            lastError: lastError.message,
            code: lastError.code,
        },
        "All retry attempts exhausted for video extraction"
    );

    Sentry.captureException(lastError, {
        tags: {
            component: "yt-dlp",
            errorType: lastError.code || "UNKNOWN",
        },
        contexts: {
            extraction: {
                url,
                attempts: maxRetries + 1,
            },
        },
    });

    if (lastError.code === "TIMEOUT") {
        throw new Error("yt-dlp timed out while fetching metadata");
    }
    if (lastError.code === "NOT_FOUND") {
        throw new Error("yt-dlp executable not found. Please install yt-dlp.");
    }
    throw new Error(
        `Failed to fetch metadata after ${maxRetries + 1} attempts: ${lastError.message}`
    );
}

/**
 * Computes video sizes for all resolutions from yt-dlp metadata
 * Uses single-pass iteration for efficiency
 * @param {Object} meta - The complete metadata object from yt-dlp
 * @param {number} [durationHint] - Optional duration hint in seconds
 * @returns {Object} Result object with ok, bytes, human, and duration fields
 * @throws {Error} If no size information could be determined
 */
function computeSizes(meta, durationHint) {
    const formats = meta.formats || [];

    let durationSec = null;
    try {
        const dur = meta.duration;
        if (typeof dur === "number") {
            durationSec = Math.round(dur);
        }
    } catch (e) {
        // ignore
    }

    if (!durationSec && typeof durationHint === "number" && durationHint > 0) {
        durationSec = Math.round(durationHint);
    }

    // Build a set of all format IDs we care about (single iteration to build index)
    const targetFormatIds = new Set();
    for (const ids of Object.values(VIDEO_FORMAT_IDS)) {
        for (const id of ids) {
            targetFormatIds.add(id);
        }
    }
    // Add specific codec variants
    targetFormatIds.add("299"); // 1080p H.264
    targetFormatIds.add("303"); // 1080p VP9
    targetFormatIds.add("399"); // 1080p AV1
    targetFormatIds.add("308"); // 1440p VP9
    targetFormatIds.add("400"); // 1440p AV1
    targetFormatIds.add(AUDIO_FALLBACK_ID);

    // Single pass: build format size map for only the IDs we care about
    const formatSizes = new Map();
    for (const f of formats) {
        const fid = f.format_id != null ? String(f.format_id) : null;
        if (fid && targetFormatIds.has(fid)) {
            const size = sizeFromFormat(f, durationSec);
            if (size) {
                formatSizes.set(fid, size);
            }
        }
    }

    // Audio size (already computed in single pass)
    const audioSize = formatSizes.get(AUDIO_FALLBACK_ID) || null;

    // Initialize output
    const bytesOut = {
        s144p: null,
        s240p: null,
        s360p: null,
        s480p: null,
        s720p: null,
        s1080p: null,
        s1440p: null,
        s1080p_299: null,
        s1080p_303: null,
        s1080p_399: null,
        s1440p_308: null,
        s1440p_400: null,
    };

    // For each resolution, pick a candidate video id (use pre-computed sizes)
    for (const [label, ids] of Object.entries(VIDEO_FORMAT_IDS)) {
        let vidSize = null;

        for (const fid of ids) {
            const sz = formatSizes.get(fid);
            if (sz) {
                vidSize = sz;
                break;
            }
        }

        if (vidSize) {
            const key = `s${label}`;
            bytesOut[key] = audioSize ? vidSize + audioSize : vidSize;
        }
    }

    // Expose specific codec variants for 1080p and 1440p (use pre-computed sizes)
    const codecVariants = [
        ["1080p", ["299", "303", "399"]],
        ["1440p", ["308", "400"]],
    ];

    for (const [res, fids] of codecVariants) {
        for (const fid of fids) {
            const sz = formatSizes.get(fid);
            if (sz) {
                bytesOut[`s${res}_${fid}`] = audioSize ? sz + audioSize : sz;
            }
        }
    }

    // Convert to human-readable
    const humanOut = {};
    for (const [k, v] of Object.entries(bytesOut)) {
        humanOut[k] = humanizeBytes(v);
    }
    humanOut.duration = humanizeDuration(durationSec);

    // Check if we got any sizes
    const hasAny = Object.values(bytesOut).some((v) => v != null);
    if (!hasAny) {
        throw new Error(
            "No size information could be determined from yt-dlp output"
        );
    }

    return {
        ok: true,
        bytes: bytesOut,
        human: humanOut,
        duration: durationSec,
    };
}

module.exports = {
    isValidYouTubeUrl,
    humanizeBytes,
    humanizeDuration,
    formatUptime,
    sizeFromFormat,
    extractInfo,
    computeSizes,
};

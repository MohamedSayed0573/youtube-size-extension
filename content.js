/**
 * Content Script for YouTube Size Extension
 *
 * This script runs on all YouTube pages and is responsible for:
 * - Detecting the currently playing video resolution and codec (itag)
 * - Monitoring video metadata changes (resolution switches, quality changes)
 * - Detecting SPA (Single Page Application) navigation events
 * - Reporting duration hints to the background worker
 * - Notifying background of page changes for auto-prefetch
 *
 * The script uses a combination of:
 * - Direct video element inspection (videoHeight, currentSrc)
 * - YouTube-specific events (yt-navigate-finish, yt-page-data-updated)
 * - Polling fallback for SPA navigation detection
 * @file Content script for detecting YouTube video metadata
 * @author YouTube Size Extension Team
 * @version 0.2.0
 */

/* global isYouTubeUrl, extractVideoId */

(function () {
    // Detect current playing resolution on YouTube and send updates
    let lastLabel = null;
    let lastHeight = null;
    let lastVideoId = null;
    let lastItag = null;

    // Shared utility functions (isYouTubeUrl, extractVideoId) are available from utils.js

    /**
     * Extracts the current video format itag from the video element's source URL
     *
     * The itag parameter identifies the specific video codec and quality being played.
     * Common itags:
     * - 299: 1080p H.264
     * - 303: 1080p VP9
     * - 399: 1080p AV1
     * - 308: 1440p VP9
     * - 400: 1440p AV1
     * @returns {string|null} The itag string (e.g., "399") or null if not found
     */
    function extractCurrentItag() {
        try {
            const v = getVideoEl();
            if (!v) return null;
            const src = v.currentSrc || "";
            if (!src) return null;
            const u = new URL(src);
            const it = u.searchParams.get("itag");
            return it || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Maps a video height (in pixels) to a standard resolution label
     *
     * Uses nearest-match logic to map actual video heights to standard labels.
     * For example, a 1088px height would map to "1080p".
     * @param {number} h - The video height in pixels
     * @returns {string|null} Resolution label (e.g., "720p", "1080p") or null
     */
    function mapHeightToLabel(h) {
        if (!h || !isFinite(h)) return null;
        const ladder = [144, 240, 360, 480, 720, 1080, 1440, 2160];
        // Use exact match or nearest below
        let best = ladder[0];
        for (const v of ladder) {
            if (h >= v) best = v;
        }
        return best + "p";
    }

    /**
     * Locates the main YouTube video element on the page
     *
     * Prefers YouTube's dedicated video.html5-main-video element, but falls back
     * to any playing video element if needed.
     * @returns {HTMLVideoElement|null} The video element or null if not found
     */
    function getVideoEl() {
        // Prefer YouTube's main video element
        const main = document.querySelector(
            "ytd-player video.html5-main-video"
        );
        if (main) return main;
        // Fallback: first playing video element
        const vids = document.querySelectorAll("video");
        for (const v of vids) {
            if (!v) continue;
            if (!v.src && v.querySelector("source") == null) continue;
            return v;
        }
        return null;
    }

    /**
     * Reads current video metadata and notifies the background worker
     *
     * Extracts:
     * - Video resolution (height and label like "720p")
     * - Current itag (codec identifier)
     * - Video duration in seconds
     * - Current URL and video ID
     *
     * Implements debouncing to avoid sending duplicate messages when values haven't changed.
     * @param {boolean} [force] - If true, bypasses debouncing and always sends
     * @returns {void}
     */
    function readAndNotify(force = false) {
        if (!isYouTubeUrl(location.href)) return;
        const vid = getVideoEl();
        const vh = vid ? vid.videoHeight || 0 : 0;
        const label = mapHeightToLabel(vh);
        const itag = extractCurrentItag();
        const videoId = extractVideoId(location.href);
        const dur = vid
            ? Math.round(Number.isFinite(vid.duration) ? vid.duration : 0)
            : 0;
        // Debounce identical values
        if (
            !force &&
            lastLabel === label &&
            lastHeight === vh &&
            lastVideoId === videoId &&
            lastItag === itag
        ) {
            return;
        }
        lastLabel = label;
        lastHeight = vh;
        lastVideoId = videoId;
        lastItag = itag;
        try {
            chrome.runtime.sendMessage(
                {
                    type: "yt_current_res",
                    url: location.href,
                    height: vh,
                    label,
                    videoId,
                    itag,
                    durationSec: dur && dur > 0 ? dur : undefined,
                },
                () => {
                    // ignore lastError
                    const _e =
                        chrome && chrome.runtime && chrome.runtime.lastError;
                    void _e;
                }
            );
        } catch (_) {}
    }

    // Track URL changes without injecting inline scripts (CSP-safe)
    let lastHref = location.href;
    let urlPollId = null;
    /**
     * Starts a polling mechanism to detect URL changes in YouTube's SPA
     *
     * YouTube is a Single Page Application that doesn't trigger full page reloads
     * when navigating between videos. This poller detects location.href changes
     * and triggers metadata updates.
     * @param {number} [intervalMs] - Polling interval in milliseconds
     * @returns {void}
     */
    function startUrlPoller(intervalMs = 1500) {
        try {
            if (urlPollId) clearInterval(urlPollId);
        } catch (_) {}
        urlPollId = setInterval(() => {
            if (location.href !== lastHref) {
                lastHref = location.href;
                setTimeout(() => readAndNotify(true), 300);
            }
        }, intervalMs);
    }

    /**
     * Sets up event listeners for YouTube's SPA navigation events
     *
     * Listens to:
     * - yt-navigate-finish: YouTube's custom navigation complete event
     * - yt-page-data-updated: YouTube's data refresh event
     * - popstate: Browser back/forward navigation
     * - visibilitychange: Tab becomes visible again
     * @returns {void}
     */
    function listenForSpaNavigations() {
        const onChange = (href) => {
            const h = href || location.href;
            if (h !== lastHref) {
                lastHref = h;
                setTimeout(() => readAndNotify(true), 300);
            }
        };
        // YouTube-specific SPA events
        window.addEventListener(
            "yt-navigate-finish",
            () => onChange(location.href),
            true
        );
        window.addEventListener(
            "yt-page-data-updated",
            () => onChange(location.href),
            true
        );
        // Fallbacks
        window.addEventListener(
            "popstate",
            () => onChange(location.href),
            true
        );
        document.addEventListener(
            "visibilitychange",
            () => {
                if (!document.hidden) onChange(location.href);
            },
            true
        );
    }

    /**
     * Initial setup function that attaches event listeners to the video element
     *
     * Monitors various video events to detect resolution changes:
     * - loadedmetadata: Video metadata is loaded
     * - loadeddata: Video data is loaded
     * - resize: Video dimensions change
     * - play/seeked: Quality may change during playback
     * @returns {void}
     */
    function setup() {
        readAndNotify(true);
        const v = getVideoEl();
        if (!v) return;
        v.addEventListener("loadedmetadata", () => readAndNotify(true));
        v.addEventListener("loadeddata", () => readAndNotify());
        v.addEventListener("resize", () => readAndNotify());
        // Some players change quality on play/seek
        v.addEventListener("play", () => setTimeout(readAndNotify, 300));
        v.addEventListener("seeked", () => setTimeout(readAndNotify, 300));
    }

    // Listen for popup requests
    try {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (!msg) return;
            if (msg.type === "get_current_res") {
                const v = getVideoEl();
                const vh = v ? v.videoHeight || 0 : 0;
                const label = mapHeightToLabel(vh);
                const itag = extractCurrentItag();
                const videoId = extractVideoId(location.href);
                const dur = v
                    ? Math.round(Number.isFinite(v.duration) ? v.duration : 0)
                    : 0;
                try {
                    sendResponse({
                        ok: true,
                        height: vh,
                        label,
                        url: location.href,
                        videoId,
                        itag,
                        durationSec: dur && dur > 0 ? dur : undefined,
                    });
                } catch (_) {}
                return true;
            }
        });
    } catch (_) {}

    // Hook into SPA navigations with minimal overhead (no inline scripts)
    listenForSpaNavigations();
    startUrlPoller(3000);

    // Kick off
    if (
        document.readyState === "complete" ||
        document.readyState === "interactive"
    ) {
        setup();
    } else {
        window.addEventListener("DOMContentLoaded", setup);
    }
})();

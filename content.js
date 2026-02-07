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

/* global isYouTubeUrl, extractVideoId, Logger */

(function () {
    // Prevent multiple injections
    if (window.hasRunYouTubeSize) return;
    window.hasRunYouTubeSize = true;

    // Detect current playing resolution on YouTube and send updates
    let lastLabel = null;
    let lastHeight = null;
    let lastVideoId = null;
    let lastItag = null;

    /**
     * Latest data received from the injected main-world script via postMessage.
     * When available, this provides authoritative playback quality from YouTube's
     * internal player API rather than DOM-inferred values.
     * @type {Object|null}
     */
    let playerApiData = null;

    /** @constant {string} Message source for outgoing requests to injected script */
    const CONTENT_MSG_SOURCE = "ytdlp-sizer-content";
    /** @constant {string} Message source expected from injected script */
    const INJECTED_MSG_SOURCE = "ytdlp-sizer-injected";

    // Shared utility functions (isYouTubeUrl, extractVideoId) are available from utils.js

    /**
     * Listens for postMessage events from the injected main-world script
     *
     * The injected script (injected.js) runs in the page's main world and has
     * access to YouTube's player API. It posts player data (quality, duration, etc.)
     * back to this content script via window.postMessage.
     */
    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (
            !event.data ||
            event.data.source !== INJECTED_MSG_SOURCE ||
            event.data.type !== "player_data"
        ) {
            return;
        }
        const payload = event.data.payload;
        if (!payload) return;

        // Validate that the data is for the current video
        const currentVideoId = extractVideoId(location.href);
        if (
            payload.videoId &&
            currentVideoId &&
            payload.videoId !== currentVideoId
        ) {
            // Stale data from a previous video — ignore
            return;
        }

        playerApiData = payload;
        // Trigger an update with the fresh player API data
        readAndNotify(true);
    });

    /**
     * Requests fresh player data from the injected main-world script
     * @returns {void}
     */
    function requestPlayerData() {
        window.postMessage(
            { source: CONTENT_MSG_SOURCE, type: "request_player_data" },
            "*"
        );
    }

    /**
     * Resolves current video info by preferring player API data over DOM inspection
     *
     * The player API (via injected.js) provides the authoritative playback quality
     * that YouTube's internal player is actually delivering. DOM inspection
     * (videoHeight, currentSrc) serves as a fallback when the player API isn't
     * available yet.
     * @returns {Object} Resolved video info with height, label, itag, videoId, dur
     */
    function getResolvedVideoInfo() {
        const vid = getVideoEl();
        const videoId = extractVideoId(location.href);

        let vh, label;

        // Check if player API data is available and current
        const apiValid =
            playerApiData &&
            playerApiData.label &&
            (!playerApiData.videoId ||
                !videoId ||
                playerApiData.videoId === videoId);

        if (apiValid) {
            // Prefer authoritative data from YouTube's player API
            label = playerApiData.label;
            vh = playerApiData.height || (vid ? vid.videoHeight || 0 : 0);
        } else {
            // Fallback to DOM inspection
            vh = vid ? vid.videoHeight || 0 : 0;
            label = mapHeightToLabel(vh);
        }

        // itag: prefer video element src parsing, fallback is not available from player API
        const itag = extractCurrentItag();

        // Duration: prefer player API (more reliable), fallback to video element
        const dur =
            apiValid && playerApiData.durationSec > 0
                ? playerApiData.durationSec
                : vid
                  ? Math.round(Number.isFinite(vid.duration) ? vid.duration : 0)
                  : 0;

        return { vh, label, itag, videoId, dur };
    }

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
        } catch (e) {
            Logger.warn("extractCurrentItag failed", e);
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
            if (!v.src && v.querySelector("source") === null) continue;
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
        const { vh, label, itag, videoId, dur } = getResolvedVideoInfo();
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
        } catch (e) {
            Logger.warn("readAndNotify sendMessage failed", e);
        }
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
        if (urlPollId) clearInterval(urlPollId);
        urlPollId = setInterval(() => {
            if (location.href !== lastHref) {
                lastHref = location.href;
                playerApiData = null; // Clear stale data on navigation
                setTimeout(() => {
                    readAndNotify(true);
                    setup(); // Rebind to new video element if YouTube replaced it
                }, 300);
            }
        }, intervalMs);

        // Cleanup on unload to prevent leaks
        window.addEventListener("beforeunload", () => {
            try {
                if (urlPollId) clearInterval(urlPollId);
            } catch (e) {
                // ignore
            }
        });
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
                playerApiData = null; // Clear stale data on navigation
                setTimeout(() => {
                    readAndNotify(true);
                    setup(); // Rebind to new video element if YouTube replaced it
                }, 300);
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
     *
     * Tracks the currently bound element so SPA navigations that replace
     * the video element will trigger a rebind.
     * @returns {void}
     */
    let boundVideoEl = null;
    /**
     *
     */
    function setup() {
        // Request fresh data from the injected main-world script
        requestPlayerData();
        readAndNotify(true);
        const v = getVideoEl();
        if (!v || v === boundVideoEl) return;
        boundVideoEl = v;
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
            if (!msg) return false;
            if (msg.type === "get_current_res") {
                const { vh, label, itag, videoId, dur } =
                    getResolvedVideoInfo();
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
                } catch (e) {
                    Logger.warn("sendResponse failed", e);
                }
                return true;
            }
            return false;
        });
    } catch (e) {
        Logger.warn("Failed to add runtime message listener", e);
    }

    // Hook into SPA navigations with minimal overhead (no inline scripts)
    listenForSpaNavigations();
    // Use 10s polling as safety fallback only - SPA events handle most cases
    startUrlPoller(10000);

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

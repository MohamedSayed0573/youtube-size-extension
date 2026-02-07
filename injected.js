/**
 * Injected Script for YouTube Size Extension (Main World)
 *
 * This script runs in the page's "Main World" context, sharing the same
 * JavaScript environment as YouTube's own scripts. This grants access to
 * YouTube's internal player API (e.g., getPlaybackQuality, getVideoData),
 * which provides authoritative resolution and playback metadata.
 *
 * Communication with the content script (isolated world) is handled via
 * window.postMessage.
 * @file Main world script for accessing YouTube's internal player API
 * @version 0.2.0
 */

(function () {
    // Prevent multiple injections
    if (window.__ytdlpSizerInjected) return;
    window.__ytdlpSizerInjected = true;

    /** @constant {string} Message source identifier for postMessage filtering */
    const MSG_SOURCE = "ytdlp-sizer-injected";

    /**
     * Maps YouTube internal quality strings from getPlaybackQuality() to heights
     * @constant {Object<string, number>}
     */
    const QUALITY_TO_HEIGHT = {
        tiny: 144,
        small: 240,
        medium: 360,
        large: 480,
        hd720: 720,
        hd1080: 1080,
        hd1440: 1440,
        hd2160: 2160,
        highres: 4320,
    };

    /**
     * Returns the YouTube movie_player element if available
     * @returns {Object|null} The YouTube player object or null
     */
    function getPlayer() {
        return document.getElementById("movie_player");
    }

    /**
     * Maps a YouTube quality string to a standard resolution label
     * @param {string} quality - YouTube quality string (e.g., "hd1080")
     * @returns {string|null} Resolution label (e.g., "1080p") or null
     */
    function qualityToLabel(quality) {
        const height = QUALITY_TO_HEIGHT[quality];
        return height ? height + "p" : null;
    }

    /**
     * Extracts the video ID from the YouTube player's internal data
     * @param {Object} player - The YouTube player object
     * @returns {string|null} The video ID or null
     */
    function getPlayerVideoId(player) {
        if (typeof player.getVideoData !== "function") return null;
        try {
            const vd = player.getVideoData();
            return vd ? vd.video_id || null : null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Extracts the video duration from the YouTube player's internal data
     * @param {Object} player - The YouTube player object
     * @returns {number|null} Duration in seconds (rounded) or null
     */
    function getPlayerDuration(player) {
        if (typeof player.getDuration !== "function") return null;
        try {
            const d = player.getDuration();
            return d && Number.isFinite(d) && d > 0 ? Math.round(d) : null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Reads current playback metadata from the YouTube player API
     *
     * Extracts:
     * - Playback quality (authoritative, from player internals)
     * - Video data (video_id, title)
     * - Duration
     * - Available quality levels
     * @returns {Object|null} Player data payload or null if player unavailable
     */
    function readPlayerData() {
        const player = getPlayer();
        if (!player || typeof player.getPlaybackQuality !== "function") {
            return null;
        }

        try {
            const quality = player.getPlaybackQuality();
            const label = qualityToLabel(quality);
            const height = QUALITY_TO_HEIGHT[quality] || 0;
            const videoId = getPlayerVideoId(player);
            const durationSec = getPlayerDuration(player);

            // Available quality levels for context
            let availableQualities = null;
            if (typeof player.getAvailableQualityLevels === "function") {
                try {
                    availableQualities = player.getAvailableQualityLevels();
                } catch (_e) {}
            }

            return {
                quality,
                label,
                height,
                videoId,
                durationSec,
                availableQualities,
            };
        } catch (_e) {
            return null;
        }
    }

    /**
     * Posts player data to the content script via window.postMessage
     * @param {Object} data - The player data payload
     * @returns {void}
     */
    function postData(data) {
        if (!data) return;
        window.postMessage(
            {
                source: MSG_SOURCE,
                type: "player_data",
                payload: data,
            },
            "*"
        );
    }

    /**
     * Reads player data and posts it to the content script
     * @returns {void}
     */
    function pollAndPost() {
        const data = readPlayerData();
        if (data) postData(data);
    }

    /**
     * Attempts to set up player API event listeners
     *
     * Polls for the movie_player element to become available and exposes its API.
     * Once found, binds to onPlaybackQualityChange and onStateChange events
     * for real-time quality tracking.
     * @returns {void}
     */
    let setupAttempts = 0;
    const MAX_SETUP_ATTEMPTS = 50; // 50 * 200ms = 10s max wait

    /**
     * Tries to locate the player and bind event listeners, retrying on failure
     * @returns {void}
     */
    function trySetup() {
        const player = getPlayer();
        if (!player || typeof player.getPlaybackQuality !== "function") {
            setupAttempts++;
            if (setupAttempts < MAX_SETUP_ATTEMPTS) {
                setTimeout(trySetup, 200);
            }
            return;
        }

        // Initial data read and broadcast
        pollAndPost();

        // Bind to player events for real-time updates
        if (typeof player.addEventListener === "function") {
            player.addEventListener("onPlaybackQualityChange", (quality) => {
                const data = readPlayerData();
                if (data) {
                    // Use the event's quality directly for freshest data
                    data.quality = quality;
                    data.label = qualityToLabel(quality);
                    data.height = QUALITY_TO_HEIGHT[quality] || data.height;
                    postData(data);
                }
            });

            player.addEventListener("onStateChange", () => {
                // Small delay to let quality settle after state change
                setTimeout(pollAndPost, 300);
            });
        }
    }

    // Listen for data requests from the content script
    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== "ytdlp-sizer-content") return;
        if (event.data.type === "request_player_data") {
            pollAndPost();
        }
    });

    // Handle YouTube SPA navigations — re-setup player listeners
    window.addEventListener("yt-navigate-finish", () => {
        setupAttempts = 0;
        setTimeout(trySetup, 500);
    });

    // Start setup
    trySetup();
})();

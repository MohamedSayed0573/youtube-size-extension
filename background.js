/**
 * Background Service Worker for YouTube Size Extension
 *
 * This service worker handles:
 * - Auto-prefetching video size data when YouTube pages load
 * - Managing cache with configurable TTL
 * - Native messaging host communication
 * - Cloud API fallback support
 * - Badge indicators and status updates
 * - Duration hints collection from content script
 * @file Background service worker for video size management
 * @requires utils.js - Shared utility functions
 * @author YouTube Size Extension Team
 * @version 0.2.0
 */

/* global isYouTubeUrl, extractVideoId, humanizeBytes, humanizeDuration, Logger, getCacheKey, cacheHasAnySize, CACHE_KEY_PREFIX, callNativeHost */
/* eslint-disable no-inner-declarations */

// Import shared utilities
importScripts("utils.js");

// HOST_NAME is now imported from utils.js

/** @constant {number} Maximum entries in tracking maps to prevent memory leaks */
const MAX_MAP_SIZE = 500;

/** @constant {number} Prune maps every N insertions to prevent memory buildup */
const PRUNE_INTERVAL = 50;

/** @type {number} Counter to trigger periodic pruning */
let insertionCounter = 0;

// In-flight requests to avoid duplicate native host calls per video
const inFlight = new Set();
const CLEAR_BADGE_MS = 8000; // Clear badge after 8s
const lastFetchMs = new Map(); // videoId -> last fetch timestamp
// Duration hints collected from content/popup to help host avoid extra duration calls
const durationHints = new Map(); // videoId -> { d: seconds, ts: epoch_ms }

/**
 * Calls the cloud API to fetch video size information
 *
 * This is an alternative to the native messaging host, allowing users to deploy
 * their own Node.js server for processing yt-dlp requests.
 * @async
 * @param {string} url - The YouTube video URL to analyze
 * @param {number} [durationHint] - Optional video duration in seconds to improve accuracy
 * @returns {Promise<Object>} Response object with structure:
 *   - {boolean} ok - Whether the request succeeded
 *   - {string} human - Human-readable size strings
 *   - {Object} bytes - Raw byte sizes for each resolution
 *   - {number} duration - Video duration in seconds
 * @throws {Error} If cloud API URL is not configured or request fails
 * @example
 *   const result = await callCloudApi('https://youtube.com/watch?v=xxx', 180);
 *   console.log(result.human.s720p); // "45.32 MB"
 */
async function callCloudApi(url, durationHint) {
    const base =
        settings && typeof settings.cloudApiUrl === "string"
            ? settings.cloudApiUrl.trim()
            : "";
    if (!base) throw new Error("Cloud API URL not configured");
    const endpoint = base; // allow full URL; if you want /size, set it in options
    const ac = new AbortController();
    const id = setTimeout(() => {
        try {
            ac.abort();
        } catch (e) {
            Logger.warn("Abort failed", e);
        }
    }, 25000);
    try {
        const body = { url };
        if (
            typeof durationHint === "number" &&
            isFinite(durationHint) &&
            durationHint > 0
        ) {
            body.duration_hint = Math.round(durationHint);
        }
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: ac.signal,
        });
        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch (e) {
            Logger.warn("Cloud API invalid JSON", e);
        }
        if (!res.ok || !json) {
            throw new Error(
                (json && json.error) || `Cloud API HTTP ${res.status}`
            );
        }
        if (!json.ok) throw new Error(json.error || "Cloud API returned error");
        return json; // { ok, human, bytes, duration? }
    } finally {
        try {
            clearTimeout(id);
        } catch (e) {
            Logger.warn("ClearTimeout failed", e);
        }
    }
}
/** @constant {number} Time-to-live for duration hints in milliseconds (1 hour) */
const HINT_TTL_MS = 60 * 60 * 1000;

/**
 * Retrieves a cached duration hint for a given video ID
 *
 * Duration hints are collected from the content script when videos play,
 * allowing us to avoid redundant duration fetches from yt-dlp.
 * @param {string} videoId - The YouTube video ID
 * @returns {number|null} Duration in seconds if found and fresh, null otherwise
 */
function getDurationHint(videoId) {
    try {
        const rec = durationHints.get(videoId);
        if (!rec) return null;
        const ts = rec && typeof rec.ts === "number" ? rec.ts : 0;
        if (!ts || Date.now() - ts > HINT_TTL_MS) {
            try {
                durationHints.delete(videoId);
            } catch (e) {
                Logger.warn("Failed to delete expired duration hint", e);
            }
            return null;
        }
        const v =
            rec && typeof rec.d === "number" && isFinite(rec.d) && rec.d > 0
                ? rec.d
                : null;
        return v ? Math.round(v) : null;
    } catch (e) {
        Logger.warn("getDurationHint failed", e);
        return null;
    }
}

/**
 * Prunes expired entries from the durationHints map and enforces size limit
 */
function pruneDurationHints() {
    try {
        const now = Date.now();
        // Remove expired entries
        for (const [vid, rec] of durationHints.entries()) {
            const ts = rec && typeof rec.ts === "number" ? rec.ts : 0;
            if (!ts || now - ts > HINT_TTL_MS) {
                durationHints.delete(vid);
            }
        }
        // Enforce size limit (LRU-style: remove oldest entries if over limit)
        if (durationHints.size > MAX_MAP_SIZE) {
            const entries = Array.from(durationHints.entries());
            entries.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
            const toRemove = entries.slice(0, entries.length - MAX_MAP_SIZE);
            for (const [vid] of toRemove) {
                durationHints.delete(vid);
            }
        }
    } catch (e) {
        Logger.warn("pruneDurationHints failed", e);
    }
}

/**
 * Prunes the lastFetchMs map to enforce size limit
 */
function pruneLastFetchMs() {
    try {
        if (lastFetchMs.size > MAX_MAP_SIZE) {
            const entries = Array.from(lastFetchMs.entries());
            entries.sort((a, b) => a[1] - b[1]); // Sort by timestamp ascending
            const toRemove = entries.slice(0, entries.length - MAX_MAP_SIZE);
            for (const [vid] of toRemove) {
                lastFetchMs.delete(vid);
            }
        }
    } catch (e) {
        Logger.warn("pruneLastFetchMs failed", e);
    }
}

/**
 * Prunes all tracking maps to prevent unbounded memory growth
 */
function pruneAllMaps() {
    pruneDurationHints();
    pruneLastFetchMs();
}

/**
 * Triggers periodic pruning based on insertion count
 * Called after each map insertion to proactively prevent memory buildup
 */
function maybeProactivePrune() {
    insertionCounter++;
    if (insertionCounter >= PRUNE_INTERVAL) {
        insertionCounter = 0;
        // Use setTimeout to not block the current operation
        setTimeout(() => {
            try {
                pruneAllMaps();
            } catch (e) {
                Logger.warn("Proactive prune failed", e);
            }
        }, 0);
    }
}

/**
 * Safely adds a duration hint with proactive pruning
 * @param {string} videoId - The video ID
 * @param {number} duration - Duration in seconds
 */
function addDurationHint(videoId, duration) {
    if (
        !videoId ||
        typeof duration !== "number" ||
        !isFinite(duration) ||
        duration <= 0
    ) {
        return;
    }
    try {
        durationHints.set(videoId, { d: Math.round(duration), ts: Date.now() });
        maybeProactivePrune();
    } catch (e) {
        Logger.warn("Failed to add duration hint", e);
    }
}

/**
 * Safely updates lastFetchMs with proactive pruning
 * @param {string} videoId - The video ID
 * @param {number} timestamp - Timestamp in milliseconds
 */
function updateLastFetchMs(videoId, timestamp) {
    if (!videoId) return;
    try {
        lastFetchMs.set(videoId, timestamp);
        maybeProactivePrune();
    } catch (e) {
        Logger.warn("Failed to update lastFetchMs", e);
    }
}

// Badge spinner management per tab
const tabBadgeTimers = new Map(); // tabId -> intervalId

// Cross-browser Promise wrappers for tabs API (Firefox expects callbacks on chrome.*)
/**
 *
 * @param queryInfo
 */
function tabsQuery(queryInfo) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.query(queryInfo, (tabs) => {
                // Swallow lastError and resolve with empty list on failure
                const _e = chrome && chrome.runtime && chrome.runtime.lastError;
                void _e;
                resolve(Array.isArray(tabs) ? tabs : []);
            });
        } catch (e) {
            Logger.warn("tabsQuery failed", e);
            resolve([]);
        }
    });
}

/**
 *
 * @param tabId
 */
function tabsGet(tabId) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.get(tabId, (tab) => {
                const _e = chrome && chrome.runtime && chrome.runtime.lastError;
                void _e;
                resolve(tab || null);
            });
        } catch (e) {
            Logger.warn("tabsGet failed", e);
            resolve(null);
        }
    });
}

/**
 * Starts an animated spinner badge on the specified tab
 *
 * Displays a cycling animation ('.', '..', '...') to indicate that
 * video size data is being fetched in the background.
 * @param {number} tabId - The Chrome tab ID to show the spinner on
 * @returns {void}
 */
function startBadgeSpinner(tabId) {
    if (
        !settings.showBadge ||
        typeof chrome.action === "undefined" ||
        typeof tabId !== "number"
    ) {
        return;
    }
    stopBadgeSpinner(tabId);
    try {
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#4a90e2" });
    } catch (e) {
        Logger.warn("Failed to set badge color", e);
    }
    const frames = [".", "..", "..."];
    let i = 0;
    const id = setInterval(() => {
        try {
            chrome.action.setBadgeText({
                tabId,
                text: frames[i % frames.length],
            });
        } catch (e) {
            Logger.warn("Failed to update badge text", e);
        }
        i++;
    }, 300);
    tabBadgeTimers.set(tabId, id);
}

/**
 * Stops the animated spinner badge on the specified tab
 * @param {number} tabId - The Chrome tab ID to stop the spinner on
 * @returns {void}
 */
function stopBadgeSpinner(tabId) {
    if (!tabBadgeTimers.has(tabId)) return;
    try {
        clearInterval(tabBadgeTimers.get(tabId));
    } catch (e) {
        Logger.warn("Failed to clear interval", e);
    }
    tabBadgeTimers.delete(tabId);
}

/**
 * Sets a green checkmark badge to indicate successful cache
 * @param {number} tabId - The Chrome tab ID to show the checkmark on
 * @returns {void}
 */
function setBadgeCheck(tabId) {
    if (
        !settings.showBadge ||
        typeof chrome.action === "undefined" ||
        typeof tabId !== "number"
    ) {
        return;
    }
    try {
        chrome.action.setBadgeText({ tabId, text: "✓" });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#27ae60" });
        chrome.action.setTitle({ tabId, title: "YouTube Size cached" });
    } catch (e) {
        Logger.warn("Failed to set success badge", e);
    }
}

/**
 *
 * @param tabId
 */
function clearBadge(tabId) {
    if (typeof chrome.action === "undefined" || typeof tabId !== "number") {
        return;
    }
    try {
        chrome.action.setBadgeText({ tabId, text: "" });
    } catch (e) {
        Logger.warn("Failed to clear badge", e);
    }
}

/**
 *
 * @param url
 * @param tabId
 */
async function ensureBadgeForTab(url, tabId) {
    if (typeof tabId !== "number") return;
    if (!isYouTubeUrl(url)) {
        clearBadge(tabId);
        return;
    }
    const vid = extractVideoId(url);
    if (!vid) {
        clearBadge(tabId);
        return;
    }
    try {
        if (await isFreshInCache(vid)) {
            setBadgeCheck(tabId);
        } else {
            clearBadge(tabId);
        }
    } catch (e) {
        Logger.warn("Failed to check cache for badge", e);
    }
}

// Settings with defaults
const defaultSettings = {
    autoPrefetch: true,
    ttlHours: 24,
    showBadge: true,
    showLength: true,
    useCloud: false,
    cloudApiUrl: "",
    resolutions: ["480p", "720p", "1080p", "1440p"],
};
let settings = { ...defaultSettings };

/**
 *
 */
function getTTLms() {
    const ttl = parseInt(settings.ttlHours, 10);
    const hours =
        Number.isFinite(ttl) && ttl > 0 ? ttl : defaultSettings.ttlHours;
    return hours * 60 * 60 * 1000;
}

/**
 *
 */
async function loadSettings() {
    try {
        const obj = await storageGet(["ytSize_settings"]);
        const s = obj && obj.ytSize_settings ? obj.ytSize_settings : {};
        settings = { ...defaultSettings, ...s };
        // Optionally merge packaged config.json overrides (if present)
        try {
            const url = chrome.runtime.getURL("config.json");
            const res = await fetch(url);
            if (res && res.ok) {
                const cfg = await res.json();
                if (cfg && typeof cfg === "object") {
                    settings = { ...settings, ...cfg };
                }
            }
        } catch (e) {
            Logger.info("Optional config.json not found or invalid", e);
        }
    } catch (e) {
        Logger.error("Failed to load settings", e);
        settings = { ...defaultSettings };
    }
}

try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes && changes.ytSize_settings) {
            try {
                const nv = changes.ytSize_settings.newValue || {};
                settings = { ...defaultSettings, ...nv };
            } catch (e) {
                Logger.warn("Failed to update settings", e);
            }
        }
    });
} catch (e) {
    Logger.warn("Failed to add storage listener", e);
}

// Shared utility functions (isYouTubeUrl, extractVideoId) are imported from utils.js

/**
 *
 * @param keys
 */
function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

/**
 *
 * @param items
 */
function storageSet(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

/**
 *
 * @param keys
 */
function storageRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

// Prefer session storage for volatile video size caches (faster, no disk I/O),
// fall back to local storage if session is unavailable.
const cacheArea =
    chrome && chrome.storage && chrome.storage.session
        ? chrome.storage.session
        : chrome.storage.local;
/**
 *
 * @param keys
 */
function cacheGet(keys) {
    return new Promise((resolve) => cacheArea.get(keys, resolve));
}
/**
 *
 * @param items
 */
function cacheSet(items) {
    return new Promise((resolve) => cacheArea.set(items, resolve));
}
/**
 *
 * @param keys
 */
function cacheRemove(keys) {
    return new Promise((resolve) => cacheArea.remove(keys, resolve));
}
/**
 *
 */
function cacheGetAll() {
    return new Promise((resolve) => cacheArea.get(null, resolve));
}

// Single storage write - use primary cache area only to avoid race conditions
// Note: Previously used dual-write to both session and local storage,
// but this caused race conditions. Now we rely on cacheArea detection
// at startup to pick the right storage and stick with it.

// cacheHasAnySize is now imported from utils.js to eliminate duplication

// callNativeHost is now imported from utils.js to eliminate duplication

/**
 * Checks if cached size data exists and is still fresh (within TTL)
 * @async
 * @param {string} videoId - The YouTube video ID to check
 * @returns {Promise<boolean>} True if cache is fresh and contains valid size data
 */
async function isFreshInCache(videoId) {
    const key = getCacheKey(videoId);
    const obj = await cacheGet([key]);
    const cached = obj[key] || null;
    if (!cached || typeof cached.timestamp !== "number") return false;
    if (!cacheHasAnySize(cached)) return false;
    return Date.now() - cached.timestamp <= getTTLms();
}

/**
 * Prefetches video size data for a YouTube URL and caches the results
 *
 * This is the main orchestration function that:
 * 1. Validates the URL and extracts the video ID
 * 2. Checks if data is already cached and fresh
 * 3. Calls either the cloud API or native host to fetch sizes
 * 4. Updates the cache and notifies open popups
 * 5. Updates the browser action badge to show status
 * @async
 * @param {string} url - The YouTube video URL to prefetch data for
 * @param {number} [tabId] - The tab ID to show badge updates on
 * @param {boolean} [forced] - If true, bypasses autoPrefetch setting and rate limits
 * @returns {Promise<void>}
 */
async function prefetchForUrl(url, tabId, forced = false) {
    if (!isYouTubeUrl(url)) return;
    const videoId = extractVideoId(url);
    if (!videoId) return;

    // Respect autoPrefetch unless this is a forced prefetch
    if (!forced && settings && settings.autoPrefetch === false) return;

    // Rate-limit frequent triggers for the same videoId
    const now = Date.now();
    const last = lastFetchMs.get(videoId) || 0;
    if (!forced && now - last < 10000) return; // 10s window

    // IMPORTANT: Check and set inFlight atomically BEFORE any async operations
    // to prevent race conditions where multiple calls could pass the check
    if (inFlight.has(videoId)) return; // already fetching
    inFlight.add(videoId);
    updateLastFetchMs(videoId, now);

    try {
        // Now safe to do async cache check - we own the lock for this videoId
        if (!forced && (await isFreshInCache(videoId))) {
            if (typeof tabId === "number") setBadgeCheck(tabId);
            return; // already fresh
        }

        // Show a spinner badge on the active tab if available
        startBadgeSpinner(tabId);

        const durationHint = getDurationHint(videoId);
        let msg = null;
        const tryCloudFirst = !!(
            settings &&
            settings.useCloud &&
            typeof settings.cloudApiUrl === "string" &&
            settings.cloudApiUrl.trim()
        );
        try {
            if (tryCloudFirst) {
                msg = await callCloudApi(url, durationHint);
            } else {
                msg = await callNativeHost(url, durationHint);
            }
        } catch (e1) {
            // Fallback to the other path
            try {
                msg = tryCloudFirst
                    ? await callNativeHost(url, durationHint)
                    : await callCloudApi(url, durationHint);
            } catch (e2) {
                throw e2 || e1;
            }
        }
        if (msg && msg.ok) {
            const key = getCacheKey(videoId);
            await cacheSet({
                [key]: {
                    timestamp: Date.now(),
                    human: msg.human || null,
                    bytes: msg.bytes || null,
                },
            });

            // Notify any open popup to refresh immediately (ignore if no listeners)
            try {
                chrome.runtime.sendMessage(
                    { type: "sizeCacheUpdated", videoId },
                    () => {
                        /* ignore */
                        const _e =
                            chrome &&
                            chrome.runtime &&
                            chrome.runtime.lastError; // swallow
                    }
                );
            } catch (e) {
                Logger.warn("Failed to send sizeCacheUpdated message", e);
            }

            // Success badge: stop spinner and show persistent checkmark
            if (typeof tabId === "number") {
                try {
                    stopBadgeSpinner(tabId);
                } catch (e) {
                    Logger.warn("Failed to stop badge spinner", e);
                }
                setBadgeCheck(tabId);
            }
        }
    } catch (e) {
        // Error badge: stop spinner; if we already have a fresh cache, keep the ✓
        if (typeof tabId === "number") {
            try {
                stopBadgeSpinner(tabId);
            } catch (e) {
                Logger.warn("Failed to stop badge spinner on error", e);
            }
            try {
                const vidFresh = await isFreshInCache(videoId);
                if (vidFresh) {
                    setBadgeCheck(tabId); // restore/keep persistent check
                } else if (
                    settings.showBadge &&
                    typeof chrome.action !== "undefined"
                ) {
                    chrome.action.setBadgeText({ tabId, text: "!" });
                    chrome.action.setBadgeBackgroundColor({
                        tabId,
                        color: "#e74c3c",
                    });
                    chrome.action.setTitle({
                        tabId,
                        title: "YouTube Size prefetch failed",
                    });
                    setTimeout(() => {
                        try {
                            chrome.action.setBadgeText({ tabId, text: "" });
                        } catch (e) {
                            Logger.warn("Failed to clear error badge", e);
                        }
                    }, CLEAR_BADGE_MS);
                }
            } catch (e) {
                Logger.warn("Failed to handle error badge state", e);
            }
        }
        try {
            chrome.runtime.sendMessage(
                {
                    type: "sizeCacheFailed",
                    videoId,
                    error: String(e && e.message ? e.message : e),
                },
                () => {
                    const _e =
                        chrome && chrome.runtime && chrome.runtime.lastError; // swallow
                }
            );
        } catch (e) {
            Logger.warn("Failed to send sizeCacheFailed message", e);
        }
        // Swallow errors; background prefetch is best-effort
    } finally {
        inFlight.delete(videoId);
    }
}

// Prefetch when a tab finishes loading a YouTube URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab || !tab.url) return;
    if (changeInfo.status === "complete" || changeInfo.url) {
        // Prefetch for any YouTube tab on load/update to honor auto-prefetch requirement
        prefetchForUrl(tab.url, tabId);
        ensureBadgeForTab(tab.url, tabId);
    }
});

// Prefetch when switching to a tab (helps when user lands on an already loaded YT tab)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await tabsGet(activeInfo.tabId);
        if (tab && tab.url) {
            prefetchForUrl(tab.url, activeInfo.tabId);
            ensureBadgeForTab(tab.url, activeInfo.tabId);
        }
    } catch (e) {
        Logger.warn("onActivated handler failed", e);
    }
});

// webNavigation listeners removed; content script notifies SPA navigations instead.

// Prefetch on startup and install for existing tabs
/**
 *
 */
async function prefetchExistingYouTubeTabs() {
    try {
        // Only prefetch for active tab(s) to reduce unnecessary startup load
        const tabs = await tabsQuery({ active: true });
        for (const t of tabs) {
            if (t && t.url && isYouTubeUrl(t.url)) {
                prefetchForUrl(t.url, t.id);
                ensureBadgeForTab(t.url, t.id);
            }
        }
    } catch (e) {
        Logger.warn("prefetchExistingYouTubeTabs failed", e);
    }
}

try {
    chrome.tabs.onRemoved.addListener((tabId) => {
        try {
            stopBadgeSpinner(tabId);
        } catch (e) {
            Logger.warn("Failed to stop badge spinner on tab remove", e);
        }
    });
} catch (e) {
    Logger.warn("Failed to add tabs.onRemoved listener", e);
}

chrome.runtime.onStartup.addListener(() => {
    pruneAllMaps();
    prefetchExistingYouTubeTabs();
});

chrome.runtime.onInstalled.addListener(() => {
    prefetchExistingYouTubeTabs();
    // Run a one-time cleanup on install
    cleanupOldCaches();
});

// Context menus removed to minimize permissions and overhead

// Cleanup old caches periodically
/**
 *
 */
async function cleanupOldCaches() {
    try {
        const all = await cacheGetAll();
        const now = Date.now();
        const keysToRemove = [];
        for (const [k, v] of Object.entries(all)) {
            if (!k.startsWith(CACHE_KEY_PREFIX)) continue;
            const ts = v && typeof v.timestamp === "number" ? v.timestamp : 0;
            // Remove entries older than 24 hours (4x TTL safety buffer could be too big; keep it simple)
            if (!ts || now - ts > 24 * 60 * 60 * 1000) {
                keysToRemove.push(k);
            }
        }
        if (keysToRemove.length) await cacheRemove(keysToRemove);
        // Also prune all tracking maps
        pruneAllMaps();
    } catch (e) {
        Logger.warn("cleanupOldCaches failed", e);
    }
}

// Alarms removed to reduce permissions; cleanup is run on install and can be
// opportunistically triggered in future updates if needed.

// Accept prefetch requests from the popup
// eslint-disable-next-line no-inner-declarations
try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
            if (!msg) return;
            // Content script notifies on SPA navigations and metadata changes
            if (msg.type === "yt_current_res") {
                const tabIdFromSender =
                    sender && sender.tab && typeof sender.tab.id === "number"
                        ? sender.tab.id
                        : undefined;
                const tabId =
                    msg && typeof msg.tabId === "number"
                        ? msg.tabId
                        : tabIdFromSender;
                const url = msg.url;
                // Capture duration hint when available
                try {
                    const dur =
                        typeof msg.durationSec === "number" &&
                        isFinite(msg.durationSec) &&
                        msg.durationSec > 0
                            ? Math.round(msg.durationSec)
                            : null;
                    const vid =
                        msg.videoId || (url ? extractVideoId(url) : null);
                    if (dur && vid) {
                        addDurationHint(vid, dur);
                    }
                } catch (e) {
                    Logger.warn("Failed to capture duration hint", e);
                }
                if (url && typeof tabId === "number") {
                    prefetchForUrl(url, tabId);
                    ensureBadgeForTab(url, tabId);
                }
                try {
                    sendResponse({ ok: true });
                } catch (e) {
                    Logger.warn("Failed to send yt_current_res response", e);
                }
                return;
            }
            if (msg.type === "ensureBadge") {
                const tabIdFromSender =
                    sender && sender.tab && typeof sender.tab.id === "number"
                        ? sender.tab.id
                        : undefined;
                const tabId =
                    msg && typeof msg.tabId === "number"
                        ? msg.tabId
                        : tabIdFromSender;
                const url = msg.url;
                if (url && typeof tabId === "number") {
                    ensureBadgeForTab(url, tabId);
                }
                try {
                    sendResponse({ ok: true });
                } catch (e) {
                    Logger.warn("Failed to send ensureBadge response", e);
                }
                return;
            }
            if (msg.type !== "prefetch" || !msg.url) return;
            const tabIdFromSender =
                sender && sender.tab && typeof sender.tab.id === "number"
                    ? sender.tab.id
                    : undefined;
            const tabId =
                msg && typeof msg.tabId === "number"
                    ? msg.tabId
                    : tabIdFromSender;
            const url = msg.url;
            if (!isYouTubeUrl(url)) {
                try {
                    sendResponse({ ok: false, reason: "not_youtube" });
                } catch (e) {
                    Logger.warn("Failed to send not_youtube response", e);
                }
                return;
            }
            const videoId = extractVideoId(url);
            if (!videoId) {
                try {
                    sendResponse({ ok: false, reason: "no_video_id" });
                } catch (e) {
                    Logger.warn("Failed to send no_video_id response", e);
                }
                return;
            }
            // Capture optional durationSec from popup-triggered prefetch
            try {
                const dur =
                    typeof msg.durationSec === "number" &&
                    isFinite(msg.durationSec) &&
                    msg.durationSec > 0
                        ? Math.round(msg.durationSec)
                        : null;
                if (dur) addDurationHint(videoId, dur);
            } catch (e) {
                Logger.warn("Failed to capture prefetch duration hint", e);
            }
            const forced = !!msg.forced;
            const now = Date.now();
            const last = lastFetchMs.get(videoId) || 0;
            const rateLimited = !forced && now - last < 10000;
            // We may need async to check freshness
            (async () => {
                const fresh = !forced && (await isFreshInCache(videoId));
                if (fresh) {
                    try {
                        sendResponse({ ok: true, reason: "fresh" });
                    } catch (e) {
                        Logger.warn("Failed to send fresh response", e);
                    }
                    return;
                }
                if (inFlight.has(videoId)) {
                    try {
                        sendResponse({ ok: true, reason: "in_flight" });
                    } catch (e) {
                        Logger.warn("Failed to send in_flight response", e);
                    }
                    return;
                }
                if (rateLimited) {
                    try {
                        sendResponse({ ok: true, reason: "rate_limited" });
                    } catch (e) {
                        Logger.warn("Failed to send rate_limited response", e);
                    }
                    return;
                }
                prefetchForUrl(url, tabId, forced);
                try {
                    sendResponse({ ok: true, reason: "started" });
                } catch (e) {
                    Logger.warn("Failed to send started response", e);
                }
            })();
            return true; // keep the message channel alive for async freshness check
        } catch (e) {
            Logger.warn("Message listener callback failed", e);
        }
    });
} catch (e) {
    Logger.warn("Failed to add message listener", e);
}

// Load settings on startup
loadSettings();

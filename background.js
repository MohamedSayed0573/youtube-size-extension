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
 * 
 * @fileoverview Main background service worker for the extension
 * @author YouTube Size Extension Team
 * @version 0.2.0
 */

/** @const {string} The native messaging host identifier */
const HOST_NAME = 'com.ytdlp.sizer';

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
 * 
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
  const base = (settings && typeof settings.cloudApiUrl === 'string') ? settings.cloudApiUrl.trim() : '';
  if (!base) throw new Error('Cloud API URL not configured');
  const endpoint = base; // allow full URL; if you want /size, set it in options
  const ac = new AbortController();
  const id = setTimeout(() => { try { ac.abort(); } catch (_) {} }, 25000);
  try {
    const body = { url };
    if (typeof durationHint === 'number' && isFinite(durationHint) && durationHint > 0) {
      body.duration_hint = Math.round(durationHint);
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (!res.ok || !json) throw new Error((json && json.error) || `Cloud API HTTP ${res.status}`);
    if (!json.ok) throw new Error(json.error || 'Cloud API returned error');
    return json; // { ok, human, bytes, duration? }
  } finally {
    try { clearTimeout(id); } catch (_) {}
  }
}
/** @const {number} Time-to-live for duration hints in milliseconds (1 hour) */
const HINT_TTL_MS = 60 * 60 * 1000;

/**
 * Retrieves a cached duration hint for a given video ID
 * 
 * Duration hints are collected from the content script when videos play,
 * allowing us to avoid redundant duration fetches from yt-dlp.
 * 
 * @param {string} videoId - The YouTube video ID
 * @returns {number|null} Duration in seconds if found and fresh, null otherwise
 */
function getDurationHint(videoId) {
  try {
    const rec = durationHints.get(videoId);
    if (!rec) return null;
    const ts = (rec && typeof rec.ts === 'number') ? rec.ts : 0;
    if (!ts || (Date.now() - ts) > HINT_TTL_MS) {
      try { durationHints.delete(videoId); } catch (_) {}
      return null;
    }
    const v = rec && typeof rec.d === 'number' && isFinite(rec.d) && rec.d > 0 ? rec.d : null;
    return v ? Math.round(v) : null;
  } catch (_) { return null; }
}

function pruneDurationHints() {
  try {
    const now = Date.now();
    for (const [vid, rec] of durationHints.entries()) {
      const ts = (rec && typeof rec.ts === 'number') ? rec.ts : 0;
      if (!ts || (now - ts) > HINT_TTL_MS) {
        try { durationHints.delete(vid); } catch (_) {}
      }
    }
  } catch (_) {}
}

// Badge spinner management per tab
const tabBadgeTimers = new Map(); // tabId -> intervalId

// Cross-browser Promise wrappers for tabs API (Firefox expects callbacks on chrome.*)
function tabsQuery(queryInfo) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(queryInfo, (tabs) => {
        // Swallow lastError and resolve with empty list on failure
        const _e = chrome && chrome.runtime && chrome.runtime.lastError; void _e;
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (_) {
      resolve([]);
    }
  });
}

function tabsGet(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        const _e = chrome && chrome.runtime && chrome.runtime.lastError; void _e;
        resolve(tab || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Starts an animated spinner badge on the specified tab
 * 
 * Displays a cycling animation ('.', '..', '...') to indicate that
 * video size data is being fetched in the background.
 * 
 * @param {number} tabId - The Chrome tab ID to show the spinner on
 * @returns {void}
 */
function startBadgeSpinner(tabId) {
  if (!settings.showBadge || typeof chrome.action === 'undefined' || typeof tabId !== 'number') return;
  stopBadgeSpinner(tabId);
  try { chrome.action.setBadgeBackgroundColor({ tabId, color: '#4a90e2' }); } catch (_) {}
  const frames = ['.', '..', '...'];
  let i = 0;
  const id = setInterval(() => {
    try { chrome.action.setBadgeText({ tabId, text: frames[i % frames.length] }); } catch (_) {}
    i++;
  }, 300);
  tabBadgeTimers.set(tabId, id);
}

/**
 * Stops the animated spinner badge on the specified tab
 * 
 * @param {number} tabId - The Chrome tab ID to stop the spinner on
 * @returns {void}
 */
function stopBadgeSpinner(tabId) {
  if (!tabBadgeTimers.has(tabId)) return;
  try { clearInterval(tabBadgeTimers.get(tabId)); } catch (_) {}
  tabBadgeTimers.delete(tabId);
}

/**
 * Sets a green checkmark badge to indicate successful cache
 * 
 * @param {number} tabId - The Chrome tab ID to show the checkmark on
 * @returns {void}
 */
function setBadgeCheck(tabId) {
  if (!settings.showBadge || typeof chrome.action === 'undefined' || typeof tabId !== 'number') return;
  try {
    chrome.action.setBadgeText({ tabId, text: '✓' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#27ae60' });
    chrome.action.setTitle({ tabId, title: 'YouTube Size cached' });
  } catch (_) {}
}

function clearBadge(tabId) {
  if (typeof chrome.action === 'undefined' || typeof tabId !== 'number') return;
  try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (_) {}
}

async function ensureBadgeForTab(url, tabId) {
  if (typeof tabId !== 'number') return;
  if (!isYouTubeUrl(url)) { clearBadge(tabId); return; }
  const vid = extractVideoId(url);
  if (!vid) { clearBadge(tabId); return; }
  try {
    if (await isFreshInCache(vid)) {
      setBadgeCheck(tabId);
    } else {
      clearBadge(tabId);
    }
  } catch (_) {}
}

// Settings with defaults
const defaultSettings = { autoPrefetch: true, ttlHours: 24, showBadge: true, showLength: true, useCloud: false, cloudApiUrl: "", resolutions: ["480p", "720p", "1080p", "1440p"] };
let settings = { ...defaultSettings };

function getTTLms() {
  const ttl = parseInt(settings.ttlHours, 10);
  const hours = Number.isFinite(ttl) && ttl > 0 ? ttl : defaultSettings.ttlHours;
  return hours * 60 * 60 * 1000;
}

async function loadSettings() {
  try {
    const obj = await storageGet(['ytSize_settings']);
    const s = obj && obj.ytSize_settings ? obj.ytSize_settings : {};
    settings = { ...defaultSettings, ...s };
    // Optionally merge packaged config.json overrides (if present)
    try {
      const url = chrome.runtime.getURL('config.json');
      const res = await fetch(url);
      if (res && res.ok) {
        const cfg = await res.json();
        if (cfg && typeof cfg === 'object') {
          settings = { ...settings, ...cfg };
        }
      }
    } catch (_) { /* ignore if missing */ }
  } catch (_) {
    settings = { ...defaultSettings };
  }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes && changes.ytSize_settings) {
      try {
        const nv = changes.ytSize_settings.newValue || {};
        settings = { ...defaultSettings, ...nv };
      } catch (_) {}
    }
  });
} catch (_) {}

/**
 * Checks if a URL is a valid YouTube video URL
 * 
 * Supports multiple YouTube URL formats:
 * - Standard: https://www.youtube.com/watch?v=VIDEO_ID
 * - Shorts: https://www.youtube.com/shorts/VIDEO_ID
 * - Short URL: https://youtu.be/VIDEO_ID
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL is a YouTube video URL, false otherwise
 */
function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.host.includes('youtube.com') || u.host.includes('youtu.be')
    ) && (
      u.searchParams.has('v') || u.pathname.startsWith('/watch') || u.host.includes('youtu.be') || /\/shorts\//.test(u.pathname)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Extracts the video ID from various YouTube URL formats
 * 
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
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    if (u.searchParams.has('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/shorts\/([\w-]{5,})/);
    if (m) return m[1];
    return null;
  } catch (_) {
    return null;
  }
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

// Prefer session storage for volatile video size caches (faster, no disk I/O),
// fall back to local storage if session is unavailable.
const cacheArea = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
function cacheGet(keys) {
  return new Promise((resolve) => cacheArea.get(keys, resolve));
}
function cacheSet(items) {
  return new Promise((resolve) => cacheArea.set(items, resolve));
}
function cacheRemove(keys) {
  return new Promise((resolve) => cacheArea.remove(keys, resolve));
}
function cacheGetAll() {
  return new Promise((resolve) => cacheArea.get(null, resolve));
}

// Dual-write helpers ensure popup/background remain in sync across Chrome versions
async function cacheSetDual(items) {
  try { await cacheSet(items); } catch (_) {}
  try { await chrome.storage.local.set(items); } catch (_) {}
}
async function cacheRemoveDual(keys) {
  try { await cacheRemove(keys); } catch (_) {}
  try { await chrome.storage.local.remove(keys); } catch (_) {}
}

// Validate that a cached entry actually contains some size data
function cacheHasAnySize(cached) {
  try {
    if (!cached) return false;
    const keys = [
      's144p','s240p','s360p','s480p','s720p','s1080p','s1440p',
      's1080p_299','s1080p_303','s1080p_399',
      's1440p_308','s1440p_400'
    ];
    const b = cached.bytes;
    const h = cached.human;
    if (b && keys.some(k => typeof b[k] === 'number' && isFinite(b[k]))) return true;
    if (h && keys.some(k => typeof h[k] === 'string' && h[k])) return true;
    return false;
  } catch (_) { return false; }
}

/**
 * Communicates with the native messaging host to fetch video sizes
 * 
 * Establishes a connection to the Python native host (ytdlp_host.py) which
 * runs yt-dlp to extract video format and size information.
 * 
 * @async
 * @param {string} url - The YouTube video URL to analyze
 * @param {number} [durationHint] - Optional duration hint in seconds
 * @returns {Promise<Object>} Response with size data for multiple resolutions
 * @throws {Error} If native host connection fails or yt-dlp returns an error
 */
function callNativeHost(url, durationHint) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      reject('Failed to connect to native host: ' + (e && e.message ? e.message : String(e)));
      return;
    }

    let responded = false;
    let disconnected = false;

    port.onMessage.addListener((msg) => {
      responded = true;
      try {
        if (msg && msg.ok) {
          resolve(msg);
        } else {
          reject((msg && msg.error) || 'Unknown error from native host.');
        }
      } finally {
        try { port.disconnect(); } catch (_) {}
      }
    });

    port.onDisconnect.addListener(() => {
      if (disconnected) return;
      disconnected = true;
      if (!responded) {
        const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Native host disconnected.';
        reject('Failed to connect to native host. ' + (err || ''));
      }
    });

    try {
      const payload = { url };
      if (typeof durationHint === 'number' && isFinite(durationHint) && durationHint > 0) {
        payload.duration_hint = Math.round(durationHint);
      }
      port.postMessage(payload);
    } catch (e) {
      reject('Failed to send request to native host: ' + (e && e.message ? e.message : String(e)));
    }
  });
}

/**
 * Checks if cached size data exists and is still fresh (within TTL)
 * 
 * @async
 * @param {string} videoId - The YouTube video ID to check
 * @returns {Promise<boolean>} True if cache is fresh and contains valid size data
 */
async function isFreshInCache(videoId) {
  const key = `sizeCache_${videoId}`;
  const obj = await cacheGet([key]);
  const cached = obj[key] || null;
  if (!cached || typeof cached.timestamp !== 'number') return false;
  if (!cacheHasAnySize(cached)) return false;
  return (Date.now() - cached.timestamp) <= getTTLms();
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
 * 
 * @async
 * @param {string} url - The YouTube video URL to prefetch data for
 * @param {number} [tabId] - The tab ID to show badge updates on
 * @param {boolean} [forced=false] - If true, bypasses autoPrefetch setting and rate limits
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
  if (!forced && (now - last) < 10000) return; // 10s window

  if (!forced && (await isFreshInCache(videoId))) {
    if (typeof tabId === 'number') setBadgeCheck(tabId);
    return; // already fresh
  }
  if (inFlight.has(videoId)) return; // already fetching
  inFlight.add(videoId);
  lastFetchMs.set(videoId, now);

  try {
    // Show a spinner badge on the active tab if available
    startBadgeSpinner(tabId);

    const durationHint = getDurationHint(videoId);
    let msg = null;
    const tryCloudFirst = !!(settings && settings.useCloud && typeof settings.cloudApiUrl === 'string' && settings.cloudApiUrl.trim());
    try {
      if (tryCloudFirst) {
        msg = await callCloudApi(url, durationHint);
      } else {
        msg = await callNativeHost(url, durationHint);
      }
    } catch (e1) {
      // Fallback to the other path
      try {
        msg = tryCloudFirst ? await callNativeHost(url, durationHint) : await callCloudApi(url, durationHint);
      } catch (e2) {
        throw (e2 || e1);
      }
    }
    if (msg && msg.ok) {
      const key = `sizeCache_${videoId}`;
      await cacheSetDual({
        [key]: {
          timestamp: Date.now(),
          human: msg.human || null,
          bytes: msg.bytes || null,
        }
      });

      // Notify any open popup to refresh immediately (ignore if no listeners)
      try {
        chrome.runtime.sendMessage({ type: 'sizeCacheUpdated', videoId }, () => {
          /* ignore */
          const _e = chrome && chrome.runtime && chrome.runtime.lastError; // swallow
        });
      } catch (_) {}

      // Success badge: stop spinner and show persistent checkmark
      if (typeof tabId === 'number') {
        try {
          stopBadgeSpinner(tabId);
        } catch (_) {}
        setBadgeCheck(tabId);
      }
    }
  } catch (e) {
    // Error badge: stop spinner; if we already have a fresh cache, keep the ✓
    if (typeof tabId === 'number') {
      try { stopBadgeSpinner(tabId); } catch (_) {}
      try {
        const vidFresh = await isFreshInCache(videoId);
        if (vidFresh) {
          setBadgeCheck(tabId); // restore/keep persistent check
        } else if (settings.showBadge && typeof chrome.action !== 'undefined') {
          chrome.action.setBadgeText({ tabId, text: '!' });
          chrome.action.setBadgeBackgroundColor({ tabId, color: '#e74c3c' });
          chrome.action.setTitle({ tabId, title: 'YouTube Size prefetch failed' });
          setTimeout(() => {
            try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (_) {}
          }, CLEAR_BADGE_MS);
        }
      } catch (_) {}
    }
    try {
      chrome.runtime.sendMessage({ type: 'sizeCacheFailed', videoId, error: String(e && e.message ? e.message : e) }, () => {
        const _e = chrome && chrome.runtime && chrome.runtime.lastError; // swallow
      });
    } catch (_) {}
    // Swallow errors; background prefetch is best-effort
  } finally {
    inFlight.delete(videoId);
  }
}

// Prefetch when a tab finishes loading a YouTube URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.url) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
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
  } catch (_) {}
});

// webNavigation listeners removed; content script notifies SPA navigations instead.

// Prefetch on startup and install for existing tabs
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
  } catch (_) {}
}

chrome.runtime.onStartup.addListener(() => {
  pruneDurationHints();
  prefetchExistingYouTubeTabs();
});

chrome.runtime.onInstalled.addListener(() => {
  prefetchExistingYouTubeTabs();
  // Run a one-time cleanup on install
  cleanupOldCaches();
});

// Context menus removed to minimize permissions and overhead

// Cleanup old caches periodically
async function cleanupOldCaches() {
  try {
    const all = await cacheGetAll();
    const now = Date.now();
    const keysToRemove = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith('sizeCache_')) continue;
      const ts = v && typeof v.timestamp === 'number' ? v.timestamp : 0;
      // Remove entries older than 24 hours (4x TTL safety buffer could be too big; keep it simple)
      if (!ts || (now - ts) > (24 * 60 * 60 * 1000)) {
        keysToRemove.push(k);
      }
    }
    if (keysToRemove.length) await cacheRemoveDual(keysToRemove);
    // Also prune duration hints
    pruneDurationHints();
   } catch (_) {}
}

// Alarms removed to reduce permissions; cleanup is run on install and can be
// opportunistically triggered in future updates if needed.

// Accept prefetch requests from the popup
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg) return;
      // Content script notifies on SPA navigations and metadata changes
      if (msg.type === 'yt_current_res') {
        const tabIdFromSender = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : undefined;
        const tabId = (msg && typeof msg.tabId === 'number') ? msg.tabId : tabIdFromSender;
        const url = msg.url;
        // Capture duration hint when available
        try {
          const dur = (typeof msg.durationSec === 'number' && isFinite(msg.durationSec) && msg.durationSec > 0) ? Math.round(msg.durationSec) : null;
          const vid = msg.videoId || (url ? extractVideoId(url) : null);
          if (dur && vid) durationHints.set(vid, { d: dur, ts: Date.now() });
        } catch (_) {}
        if (url && typeof tabId === 'number') {
          prefetchForUrl(url, tabId);
          ensureBadgeForTab(url, tabId);
        }
        try { sendResponse({ ok: true }); } catch (_) {}
        return;
      }
      if (msg.type === 'ensureBadge') {
        const tabIdFromSender = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : undefined;
        const tabId = (msg && typeof msg.tabId === 'number') ? msg.tabId : tabIdFromSender;
        const url = msg.url;
        if (url && typeof tabId === 'number') ensureBadgeForTab(url, tabId);
        try { sendResponse({ ok: true }); } catch (_) {}
        return;
      }
      if (msg.type !== 'prefetch' || !msg.url) return;
      const tabIdFromSender = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : undefined;
      const tabId = (msg && typeof msg.tabId === 'number') ? msg.tabId : tabIdFromSender;
      const url = msg.url;
      if (!isYouTubeUrl(url)) {
        try { sendResponse({ ok: false, reason: 'not_youtube' }); } catch (_) {}
        return;
      }
      const videoId = extractVideoId(url);
      if (!videoId) {
        try { sendResponse({ ok: false, reason: 'no_video_id' }); } catch (_) {}
        return;
      }
      // Capture optional durationSec from popup-triggered prefetch
      try {
        const dur = (typeof msg.durationSec === 'number' && isFinite(msg.durationSec) && msg.durationSec > 0) ? Math.round(msg.durationSec) : null;
        if (dur) durationHints.set(videoId, { d: dur, ts: Date.now() });
      } catch (_) {}
      const forced = !!msg.forced;
      const now = Date.now();
      const last = lastFetchMs.get(videoId) || 0;
      const rateLimited = !forced && (now - last) < 10000;
      // We may need async to check freshness
      (async () => {
        const fresh = !forced && (await isFreshInCache(videoId));
        if (fresh) {
          try { sendResponse({ ok: true, reason: 'fresh' }); } catch (_) {}
          return;
        }
        if (inFlight.has(videoId)) {
          try { sendResponse({ ok: true, reason: 'in_flight' }); } catch (_) {}
          return;
        }
        if (rateLimited) {
          try { sendResponse({ ok: true, reason: 'rate_limited' }); } catch (_) {}
          return;
        }
        prefetchForUrl(url, tabId, forced);
        try { sendResponse({ ok: true, reason: 'started' }); } catch (_) {}
      })();
      return true; // keep the message channel alive for async freshness check
    } catch (_) {}
  });
} catch (_) {}

// Load settings on startup
loadSettings();

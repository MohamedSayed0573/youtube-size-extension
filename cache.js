// Cache and hint management for background service worker
/* eslint-disable jsdoc/require-jsdoc, no-unused-vars */
/* exported cacheGet, cacheSet, cacheRemove, cacheGetAll, isFreshInCache, addDurationHint, getDurationHint, updateLastFetchMs, recentlyFetched, pruneAllMaps, cleanupOldCaches */
/* global Logger, getCacheKey, cacheHasAnySize */

const MAX_MAP_SIZE = 500;
const PRUNE_INTERVAL = 50;
const HINT_TTL_MS = 60 * 60 * 1000;
let insertionCounter = 0;
const durationHints = new Map(); // videoId -> { d, ts }
const lastFetchMs = new Map(); // videoId -> timestamp

function getCacheArea() {
    return chrome && chrome.storage && chrome.storage.session
        ? chrome.storage.session
        : chrome.storage.local;
}

function cacheGet(keys) {
    return new Promise((resolve) => {
        getCacheArea().get(keys, resolve);
    });
}

function cacheSet(items) {
    return new Promise((resolve) => {
        getCacheArea().set(items, resolve);
    });
}

function cacheRemove(keys) {
    return new Promise((resolve) => {
        getCacheArea().remove(keys, resolve);
    });
}

function cacheGetAll() {
    return new Promise((resolve) => {
        getCacheArea().get(null, resolve);
    });
}

function getTTLms(settings, fallbackHours = 24) {
    const ttl = parseInt(settings && settings.ttlHours, 10);
    const hours = Number.isFinite(ttl) && ttl > 0 ? ttl : fallbackHours;
    return hours * 60 * 60 * 1000;
}

async function isFreshInCache(videoId, settings, fallbackHours) {
    const key = getCacheKey(videoId);
    const obj = await cacheGet([key]);
    const cached = obj[key] || null;
    if (!cached || typeof cached.timestamp !== "number") return false;
    if (!cacheHasAnySize(cached)) return false;
    const ttlMs = getTTLms(settings, fallbackHours);
    return Date.now() - cached.timestamp <= ttlMs;
}

function pruneMap(map, { ttl, getTimestamp, maxSize, name }) {
    try {
        if (ttl) {
            const now = Date.now();
            for (const [key, value] of map.entries()) {
                const ts = getTimestamp(value);
                if (!ts || now - ts > ttl) {
                    map.delete(key);
                }
            }
        }
        if (map.size > maxSize) {
            const entries = Array.from(map.entries());
            entries.sort(
                (a, b) => (getTimestamp(a[1]) || 0) - (getTimestamp(b[1]) || 0)
            );
            const toRemove = entries.slice(0, entries.length - maxSize);
            for (const [key] of toRemove) {
                map.delete(key);
            }
        }
    } catch (e) {
        Logger.warn(`pruneMap(${name}) failed`, e);
    }
}

function pruneAllMaps() {
    pruneMap(durationHints, {
        ttl: HINT_TTL_MS,
        getTimestamp: (rec) => (rec && typeof rec.ts === "number" ? rec.ts : 0),
        maxSize: MAX_MAP_SIZE,
        name: "durationHints",
    });
    pruneMap(lastFetchMs, {
        getTimestamp: (ts) => ts,
        maxSize: MAX_MAP_SIZE,
        name: "lastFetchMs",
    });
}

function maybeProactivePrune() {
    insertionCounter++;
    if (insertionCounter >= PRUNE_INTERVAL) {
        insertionCounter = 0;
        setTimeout(() => {
            try {
                pruneAllMaps();
            } catch (e) {
                Logger.warn("Proactive prune failed", e);
            }
        }, 0);
    }
}

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

function getDurationHint(videoId) {
    const rec = durationHints.get(videoId);
    if (!rec) return null;
    const ts = typeof rec.ts === "number" ? rec.ts : 0;
    if (!ts || Date.now() - ts > HINT_TTL_MS) {
        durationHints.delete(videoId);
        return null;
    }
    const v =
        typeof rec.d === "number" && isFinite(rec.d) && rec.d > 0
            ? rec.d
            : null;
    return v ? Math.round(v) : null;
}

function updateLastFetchMs(videoId, timestamp) {
    if (!videoId) return;
    try {
        lastFetchMs.set(videoId, timestamp);
        maybeProactivePrune();
    } catch (e) {
        Logger.warn("Failed to update lastFetchMs", e);
    }
}

function recentlyFetched(videoId, windowMs) {
    const last = lastFetchMs.get(videoId) || 0;
    return Date.now() - last < windowMs;
}

async function cleanupOldCaches(prefix, maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
        const all = await cacheGetAll();
        const now = Date.now();
        const keysToRemove = [];
        for (const [k, v] of Object.entries(all)) {
            if (!k.startsWith(prefix)) continue;
            const ts = v && typeof v.timestamp === "number" ? v.timestamp : 0;
            if (!ts || now - ts > maxAgeMs) {
                keysToRemove.push(k);
            }
        }
        if (keysToRemove.length) await cacheRemove(keysToRemove);
        pruneAllMaps();
    } catch (e) {
        Logger.warn("cleanupOldCaches failed", e);
    }
}

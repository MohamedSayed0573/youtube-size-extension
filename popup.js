/* global humanizeBytes, humanizeDuration, extractVideoId, isYouTubeUrl, Logger, getCacheKey, cacheHasAnySize, callNativeHost */

(async () => {
    const statusEl = document.getElementById("status");
    const resultEl = document.getElementById("result");
    const errEl = document.getElementById("err");
    const sizesContainer = document.getElementById("sizes");
    const durationEl = document.getElementById("duration");
    const durationRowEl = document.getElementById("durationRow");
    const refreshBtn = document.getElementById("refresh");
    const noteEl = document.getElementById("note");
    const optionsBtn = document.getElementById("optionsBtn");

    // Track the current page/video for live updates
    let currentVideoId = null;
    let currentUrl = null;
    let currentTabId = null;
    let statusSpinTimer = null;
    let selectedResolutions = ["480p", "720p", "1080p", "1440p"]; // default fallback
    let showLength = true;
    let currentResLabel = null; // e.g., "720p"
    let currentItag = null; // e.g., "399"
    let lastHumanMap = null;
    let lastBytesMap = null;
    let lastDuration = null;
    let currentDurationSec = null;
    let lastIsEstimated = false;

    // Bind Options button immediately so it works even if we early-return later
    if (optionsBtn) {
        optionsBtn.onclick = () => {
            try {
                if (
                    chrome &&
                    chrome.runtime &&
                    chrome.runtime.openOptionsPage
                ) {
                    chrome.runtime.openOptionsPage();
                } else if (chrome && chrome.runtime && chrome.runtime.getURL) {
                    const url = chrome.runtime.getURL("options.html");
                    if (chrome.tabs && chrome.tabs.create) {
                        chrome.tabs.create({ url });
                    } else {
                        window.open(url, "_blank");
                    }
                } else {
                    window.open("options.html", "_blank");
                }
            } catch (e) {
                // last resort
                try {
                    window.open("options.html", "_blank");
                } catch (e2) {
                    Logger.warn("Failed to open options page", e2);
                }
            }
        };
    }

    /**
     * Estimates video file size based on resolution and duration
     *
     * Uses average bitrate estimates for each resolution tier:
     * - 144p: 0.1 Mbps
     * - 240p: 0.3 Mbps
     * - 360p: 0.6 Mbps
     * - 480p: 1.2 Mbps
     * - 720p: 2.5 Mbps
     * - 1080p: 5.5 Mbps
     * - 1440p: 9.0 Mbps
     * @param {number} height - The video height (144, 240, 360, etc.)
     * @param {number} durationSec - Video duration in seconds
     * @returns {number|null} Estimated size in bytes, or null if duration invalid
     */
    function estimateSizeBytesByHeight(height, durationSec) {
        if (!durationSec || !isFinite(durationSec) || durationSec <= 0) {
            return null;
        }
        const avgMbps = {
            144: 0.1,
            240: 0.3,
            360: 0.6,
            480: 1.2,
            720: 2.5,
            1080: 5.5,
            1440: 9.0,
        };
        const rate = avgMbps[height] || 1.2; // fallback
        const bytes = ((rate * 1000000) / 8) * durationSec; // Mbps -> Bps
        return Math.max(0, Math.round(bytes));
    }
    /**
     * Builds complete size estimate maps for all selected resolutions
     *
     * Creates both human-readable and byte-value maps based on duration.
     * Used to show quick estimates while exact data is being fetched.
     * @param {number} durationSec - Video duration in seconds
     * @returns {Object} Object containing:
     *   - {Object} humanMap - Human-readable sizes (e.g., "45.32 MB")
     *   - {Object} bytesMap - Raw byte values
     */
    function buildEstimateMaps(durationSec) {
        const order = [
            "144p",
            "240p",
            "360p",
            "480p",
            "720p",
            "1080p",
            "1440p",
        ];
        const keyMap = {
            "144p": "s144p",
            "240p": "s240p",
            "360p": "s360p",
            "480p": "s480p",
            "720p": "s720p",
            "1080p": "s1080p",
            "1440p": "s1440p",
        };
        const list = order.filter((r) => selectedResolutions.includes(r));
        const bytesMap = {};
        const humanMap = {};
        for (const r of list) {
            const h = parseInt(r);
            const b = estimateSizeBytesByHeight(h, durationSec);
            const k = keyMap[r];
            if (k) {
                bytesMap[k] = b;
                humanMap[k] = humanizeBytes(b);
            }
        }
        return { humanMap, bytesMap };
    }

    /**
     * Starts an animated text spinner in the status element
     *
     * Displays a cycling animation to indicate background processing.
     * @param {string} [base] - The base status message
     * @returns {void}
     */
    function startStatusSpinner(base = "Refreshing") {
        try {
            clearInterval(statusSpinTimer);
        } catch (e) {
            Logger.warn("Failed to clear status spinner interval", e);
        }
        let i = 0;
        const frames = ["", ".", "..", "..."];
        statusEl.style.display = "block";
        statusSpinTimer = setInterval(() => {
            statusEl.textContent = base + frames[i % frames.length];
            i += 1;
        }, 350);
    }

    /**
     *
     */
    function stopStatusSpinner() {
        if (statusSpinTimer) {
            try {
                clearInterval(statusSpinTimer);
            } catch (e) {
                Logger.warn("Failed to clear status spinner interval", e);
            }
            statusSpinTimer = null;
        }
    }

    // humanizeDuration is now imported from utils.js to eliminate duplication

    // Cache config (synced with options)
    let TTL_MS = 24 * 60 * 60 * 1000; // default 24 hours
    const defaultSettings = {
        autoPrefetch: true,
        ttlHours: 24,
        showBadge: true,
        showLength: true,
        resolutions: ["480p", "720p", "1080p", "1440p"],
    };
    /**
     *
     */
    async function loadSettings() {
        try {
            const obj = await settingsGet(["ytSize_settings"]);
            const s = obj && obj.ytSize_settings ? obj.ytSize_settings : {};
            const cfg = Object.assign({}, defaultSettings, s);
            const hrs = parseInt(cfg.ttlHours, 10);
            const h =
                Number.isFinite(hrs) && hrs > 0
                    ? hrs
                    : defaultSettings.ttlHours;
            TTL_MS = h * 60 * 60 * 1000;
            if (Array.isArray(cfg.resolutions) && cfg.resolutions.length) {
                selectedResolutions = cfg.resolutions;
            } else {
                selectedResolutions = defaultSettings.resolutions;
            }
            showLength = cfg.showLength !== false; // default to true if absent
            if (durationRowEl) {
                durationRowEl.style.display = showLength ? "" : "none";
            }
        } catch (e) {
            Logger.warn("Failed to load settings in popup", e);
        }
    }

    // Lightweight helpers: settings in persistent local, cache in fast session (fallback to local)
    const ls =
        typeof window !== "undefined" && window.localStorage
            ? window.localStorage
            : null;
    const settingsArea =
        typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
            ? chrome.storage.local
            : null;
    const cacheArea =
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.session
            ? chrome.storage.session
            : settingsArea;

    /**
     *
     * @param area
     */
    function makeGet(area) {
        return (keys) =>
            new Promise((resolve) => {
                if (area && typeof area.get === "function") {
                    area.get(keys, resolve);
                } else if (ls) {
                    const result = {};
                    try {
                        const arr = Array.isArray(keys)
                            ? keys
                            : Object.keys(keys || {});
                        for (const k of arr) {
                            const raw = ls.getItem(k);
                            if (raw != null) {
                                try {
                                    result[k] = JSON.parse(raw);
                                } catch (e) {
                                    Logger.warn(
                                        "Failed to parse localStorage item",
                                        e
                                    );
                                }
                            }
                        }
                    } catch (e) {
                        Logger.warn("Failed to access localStorage", e);
                    }
                    resolve(result);
                } else {
                    resolve({});
                }
            });
    }
    /**
     *
     * @param area
     */
    function makeSet(area) {
        return (items) =>
            new Promise((resolve) => {
                if (area && typeof area.set === "function") {
                    area.set(items, resolve);
                } else if (ls) {
                    try {
                        for (const [k, v] of Object.entries(items || {})) {
                            ls.setItem(k, JSON.stringify(v));
                        }
                    } catch (e) {
                        Logger.warn("Failed to set localStorage", e);
                    }
                    resolve();
                } else {
                    resolve();
                }
            });
    }

    const settingsGet = makeGet(settingsArea);
    const settingsSet = makeSet(settingsArea);
    const cacheGet = makeGet(cacheArea);
    const cacheSet = makeSet(cacheArea);

    // Cross-browser Promise wrapper for tabs.query
    /**
     *
     * @param queryInfo
     */
    function tabsQuery(queryInfo) {
        return new Promise((resolve) => {
            try {
                chrome.tabs.query(queryInfo, (tabs) => {
                    const _e =
                        chrome && chrome.runtime && chrome.runtime.lastError;
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
     * @param msg
     */
    function showError(msg) {
        statusEl.style.display = "none";
        resultEl.style.display = "none";
        errEl.style.display = "block";
        errEl.textContent = msg;
        noteEl.textContent = "";
        refreshBtn.style.display = "none";
    }

    /**
     * Renders the size information table in the popup UI
     *
     * Creates rows for each selected resolution with:
     * - Resolution label (144p, 720p, etc.)
     * - Size value(s) - may show multiple codec variants for 1080p/1440p
     * - "(current)" indicator if this is the playing resolution
     * - "Est." prefix for estimated values
     *
     * Special handling:
     * - 1080p shows H.264/VP9/AV1 variants if available
     * - 1440p shows VP9/AV1 variants if available
     * - If current resolution matches and we know the itag, shows only that codec
     * @param {Object} humanMap - Human-readable size strings
     * @param {Object} bytesMap - Raw byte values
     * @returns {void}
     */
    function renderSizes(humanMap, bytesMap) {
        const keyMap = {
            "144p": "s144p",
            "240p": "s240p",
            "360p": "s360p",
            "480p": "s480p",
            "720p": "s720p",
            "1080p": "s1080p",
            "1440p": "s1440p",
        };
        const order = [
            "144p",
            "240p",
            "360p",
            "480p",
            "720p",
            "1080p",
            "1440p",
        ];
        const selectedOrdered = order.filter((r) =>
            selectedResolutions.includes(r)
        );
        // Clear existing content safely
        sizesContainer.replaceChildren();

        const frag = document.createDocumentFragment();
        for (const r of selectedOrdered) {
            const key = keyMap[r];
            const human = humanMap && humanMap[key];
            const bytes = bytesMap && bytesMap[key];

            // Build variant lists (only for 1080p and 1440p)
            let variantDefs = [];
            if (r === "1080p") {
                variantDefs = [
                    { key: "s1080p_299", codec: "H.264", itag: "299" },
                    { key: "s1080p_303", codec: "VP9", itag: "303" },
                    { key: "s1080p_399", codec: "AV1", itag: "399" },
                ];
            } else if (r === "1440p") {
                variantDefs = [
                    { key: "s1440p_308", codec: "VP9", itag: "308" },
                    { key: "s1440p_400", codec: "AV1", itag: "400" },
                ];
            }

            const available = [];
            for (const def of variantDefs) {
                const hv = humanMap && humanMap[def.key];
                const bv = bytesMap && bytesMap[def.key];
                const vv = hv || humanizeBytes(bv);
                if (vv) available.push({ def, value: vv });
            }

            const rowDiv = document.createElement("div");
            rowDiv.className = "row";
            const labelSpan = document.createElement("span");
            labelSpan.className = "label";
            labelSpan.textContent = r + ":";
            const valueSpan = document.createElement("span");
            valueSpan.className = "value";

            // If variants exist and current playing resolution matches r and we know the current itag, show only that variant
            if (available.length > 0 && currentResLabel === r && currentItag) {
                const it = String(currentItag);
                const chosen = available.find((v) => v.def.itag === it);
                if (chosen) {
                    const part = `${chosen.def.codec}: ${lastIsEstimated ? "Est. " : ""}${chosen.value}`;
                    valueSpan.textContent = part;
                    rowDiv.appendChild(labelSpan);
                    rowDiv.appendChild(document.createTextNode(" "));
                    rowDiv.appendChild(valueSpan);
                    if (currentResLabel && r === currentResLabel) {
                        rowDiv.appendChild(document.createTextNode(" "));
                        const curSpan = document.createElement("span");
                        curSpan.className = "muted";
                        curSpan.textContent = "(current)";
                        rowDiv.appendChild(curSpan);
                    }
                    frag.appendChild(rowDiv);
                    continue;
                }
                // If no exact match, fall through to show all variants
            }

            if (available.length > 0) {
                // Show multiple options side-by-side in one row with the resolution label on the left
                const parts = available
                    .map(
                        (v) =>
                            `${v.def.codec}: ${lastIsEstimated ? "Est. " : ""}${v.value}`
                    )
                    .join("  |  ");
                valueSpan.textContent = parts;
            } else {
                const val = human || humanizeBytes(bytes) || "N/A";
                valueSpan.textContent =
                    lastIsEstimated && val !== "N/A" ? `Est. ${val}` : val;
            }

            rowDiv.appendChild(labelSpan);
            rowDiv.appendChild(document.createTextNode(" "));
            rowDiv.appendChild(valueSpan);
            if (currentResLabel && r === currentResLabel) {
                rowDiv.appendChild(document.createTextNode(" "));
                const curSpan = document.createElement("span");
                curSpan.className = "muted";
                curSpan.textContent = "(current)";
                rowDiv.appendChild(curSpan);
            }

            frag.appendChild(rowDiv);
        }

        sizesContainer.appendChild(frag);
    }

    /**
     * Displays the results in the popup UI
     *
     * Updates all UI elements with size data, duration, and status notes.
     * Shows the result container and hides status/error messages.
     * @param {Object} humanMap - Human-readable size strings
     * @param {Object} bytesMap - Raw byte values
     * @param {string} note - Status note to display (e.g., "Cached • 5 min ago")
     * @param {string} duration - Formatted duration string
     * @param {boolean} isEstimated - Whether values are estimates or exact
     * @returns {void}
     */
    function showResult(humanMap, bytesMap, note, duration, isEstimated) {
        statusEl.style.display = "none";
        errEl.style.display = "none";
        resultEl.style.display = "block";
        lastHumanMap = humanMap || null;
        lastBytesMap = bytesMap || null;
        lastDuration = duration || null;
        lastIsEstimated = !!isEstimated;
        renderSizes(humanMap, bytesMap);
        if (durationEl) {
            durationEl.textContent = duration ?? "N/A";
        }
        noteEl.textContent = note || "";
        noteEl.title = note || "";
        refreshBtn.style.display = "inline-block";
    }

    // Shared utility functions (isYouTubeUrl, extractVideoId, humanizeBytes) are available from utils.js

    /**
     *
     * @param ts
     */
    function formatAge(ts) {
        const ageMs = Date.now() - ts;
        const mins = Math.floor(ageMs / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins} min ago`;
        const hrs = Math.floor(mins / 60);
        return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    }

    // cacheHasAnySize is now imported from utils.js to eliminate duplication

    /**
     * Reads cached size data for a video from storage
     * @async
     * @param {string} videoId - The YouTube video ID
     * @returns {Promise<Object|null>} Cached data object or null if not found
     */
    async function readCache(videoId) {
        const key = getCacheKey(videoId);
        const obj = await cacheGet([key]);
        return obj[key] || null;
    }

    /**
     *
     * @param videoId
     * @param data
     */
    async function writeCache(videoId, data) {
        const key = getCacheKey(videoId);
        await cacheSet({ [key]: data });
    }

    // callNativeHost is now imported from utils.js to eliminate duplication

    /**
     *
     * @param url
     * @param forced
     * @param tabId
     * @param durationSec
     */
    function requestBackgroundPrefetch(
        url,
        forced = false,
        tabId,
        durationSec
    ) {
        return new Promise((resolve, reject) => {
            try {
                if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                    return resolve({ ok: false });
                }
                const msg = { type: "prefetch", url, forced, tabId };
                if (
                    typeof durationSec === "number" &&
                    isFinite(durationSec) &&
                    durationSec > 0
                ) {
                    msg.durationSec = Math.round(durationSec);
                }
                chrome.runtime.sendMessage(msg, (resp) => {
                    const err =
                        chrome && chrome.runtime && chrome.runtime.lastError
                            ? chrome.runtime.lastError
                            : null;
                    if (err) {
                        resolve({
                            ok: false,
                            error: err.message || String(err),
                        });
                        return;
                    }
                    resolve(resp || { ok: true });
                });
            } catch (e) {
                resolve({
                    ok: false,
                    error: String(e && e.message ? e.message : e),
                });
            }
        });
    }

    try {
        await loadSettings();
        const tabs = await tabsQuery({ active: true, currentWindow: true });
        const url = tabs && tabs[0] && tabs[0].url;
        currentTabId = tabs && tabs[0] && tabs[0].id;

        if (!url) {
            showError("Could not read current tab URL.");
            return;
        }

        // Ask background to ensure the badge reflects current cache state
        try {
            chrome.runtime.sendMessage(
                { type: "ensureBadge", url, tabId: currentTabId },
                () => {
                    const _e =
                        chrome && chrome.runtime && chrome.runtime.lastError; // ignore
                }
            );
        } catch (e) {
            Logger.warn("Failed to send ensureBadge message", e);
        }

        if (!isYouTubeUrl(url)) {
            showError(
                "Please open a YouTube video page and click the extension again."
            );
            return;
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            showError(
                "Could not extract YouTube video ID from the current URL."
            );
            return;
        }
        currentVideoId = videoId;
        currentUrl = url;

        refreshBtn.style.display = "inline-block";

        // Ask content script for current resolution
        try {
            chrome.tabs.sendMessage(
                currentTabId,
                { type: "get_current_res" },
                (resp) => {
                    const _e =
                        chrome && chrome.runtime && chrome.runtime.lastError; // ignore
                    if (resp && resp.ok) {
                        if (resp.videoId === currentVideoId) {
                            currentResLabel = resp.label || null;
                            currentItag = resp.itag || null;
                            currentDurationSec =
                                typeof resp.durationSec === "number" &&
                                isFinite(resp.durationSec) &&
                                resp.durationSec > 0
                                    ? Math.round(resp.durationSec)
                                    : null;
                            if (resultEl.style.display !== "none") {
                                renderSizes(lastHumanMap, lastBytesMap);
                            }
                        }
                    }
                }
            );
        } catch (e) {
            Logger.warn("Failed to send get_current_res message", e);
        }

        // Try cache first
        const cached = await readCache(videoId);
        const now = Date.now();
        const isFresh =
            cached &&
            typeof cached.timestamp === "number" &&
            now - cached.timestamp <= TTL_MS;
        const hasSizes = cacheHasAnySize(cached);
        const isFreshGood = isFresh && hasSizes;

        if (isFreshGood) {
            const dur =
                cached.human && cached.human.duration
                    ? cached.human.duration
                    : null;
            showResult(
                cached.human,
                cached.bytes,
                `Cached • ${formatAge(cached.timestamp)}`,
                dur
            );
        } else if (cached && hasSizes) {
            const dur =
                cached.human && cached.human.duration
                    ? cached.human.duration
                    : null;
            showResult(
                cached.human,
                cached.bytes,
                `Cached (stale) • ${formatAge(cached.timestamp)} • refreshing…`,
                dur
            );
            startStatusSpinner("Refreshing");
        } else {
            // No usable cache (or cache contains no sizes). Prefer quick estimates if we know duration.
            if (currentDurationSec) {
                const { humanMap, bytesMap } =
                    buildEstimateMaps(currentDurationSec);
                showResult(
                    humanMap,
                    bytesMap,
                    "Estimated • fetching exact…",
                    humanizeDuration(currentDurationSec),
                    true
                );
            } else {
                statusEl.textContent = "Contacting native host…";
            }
            startStatusSpinner("Refreshing");
        }

        /**
         *
         */
        const doFetch = async () => {
            try {
                startStatusSpinner("Refreshing");
                const resp = await requestBackgroundPrefetch(
                    url,
                    true /* forced */,
                    currentTabId,
                    currentDurationSec || undefined
                );
                if (!resp || resp.ok === false) {
                    // Fallback: call native directly (older browsers or if messaging fails)
                    const msg = await callNativeHost(
                        url,
                        currentDurationSec || undefined
                    );
                    if (msg && msg.ok) {
                        const dur =
                            msg.human && msg.human.duration
                                ? msg.human.duration
                                : null;
                        await writeCache(videoId, {
                            timestamp: Date.now(),
                            human: msg.human || null,
                            bytes: msg.bytes || null,
                        });
                        showResult(msg.human, msg.bytes, "Just updated", dur);
                        stopStatusSpinner();
                        statusEl.style.display = "none";
                    } else {
                        throw new Error(
                            (msg && msg.error) ||
                                "Unknown error from native host."
                        );
                    }
                } else {
                    // Handle reasons from background so we don't freeze
                    const reason = resp.reason || "started";
                    if (reason === "fresh") {
                        // Cache already fresh; re-read and show as up-to-date
                        const cached2 = await readCache(videoId);
                        const dur =
                            cached2 && cached2.human && cached2.human.duration
                                ? cached2.human.duration
                                : null;
                        showResult(
                            cached2 && cached2.human,
                            cached2 && cached2.bytes,
                            "Up to date",
                            dur
                        );
                        stopStatusSpinner();
                        statusEl.style.display = "none";
                    } else if (
                        reason === "in_flight" ||
                        reason === "rate_limited"
                    ) {
                        // Keep showing cached and update the note
                        noteEl.textContent =
                            reason === "in_flight"
                                ? "Refresh in progress…"
                                : "Refresh rate-limited; using cached";
                        stopStatusSpinner();
                        statusEl.style.display = "none";
                    } else {
                        // started: wait for sizeCacheUpdated; show spinner with fallback timeout
                        startStatusSpinner("Refreshing");
                        setTimeout(async () => {
                            if (!statusSpinTimer) return; // already updated
                            const cached3 = await readCache(videoId);
                            const hasSizes =
                                cached3 &&
                                ((cached3.human &&
                                    (cached3.human.s480p ||
                                        cached3.human.s720p ||
                                        cached3.human.s1080p ||
                                        cached3.human.s1440p ||
                                        cached3.human.s1080p_299 ||
                                        cached3.human.s1080p_303 ||
                                        cached3.human.s1080p_399 ||
                                        cached3.human.s1440p_308 ||
                                        cached3.human.s1440p_400)) ||
                                    (cached3.bytes &&
                                        (cached3.bytes.s480p != null ||
                                            cached3.bytes.s720p != null ||
                                            cached3.bytes.s1080p != null ||
                                            cached3.bytes.s1440p != null ||
                                            cached3.bytes.s1080p_299 != null ||
                                            cached3.bytes.s1080p_303 != null ||
                                            cached3.bytes.s1080p_399 != null ||
                                            cached3.bytes.s1440p_308 != null ||
                                            cached3.bytes.s1440p_400 != null)));
                            if (!hasSizes) {
                                // Fallback to direct host call to avoid persistent N/A
                                try {
                                    const msg = await callNativeHost(
                                        url,
                                        currentDurationSec || undefined
                                    );
                                    if (msg && msg.ok) {
                                        const dur =
                                            msg.human && msg.human.duration
                                                ? msg.human.duration
                                                : null;
                                        await writeCache(videoId, {
                                            timestamp: Date.now(),
                                            human: msg.human || null,
                                            bytes: msg.bytes || null,
                                        });
                                        showResult(
                                            msg.human,
                                            msg.bytes,
                                            "Just updated",
                                            dur
                                        );
                                        stopStatusSpinner();
                                        statusEl.style.display = "none";
                                        return;
                                    }
                                } catch (e) {
                                    Logger.warn(
                                        "Fallback direct host call failed",
                                        e
                                    );
                                }
                            }
                            const dur =
                                cached3 &&
                                cached3.human &&
                                cached3.human.duration
                                    ? cached3.human.duration
                                    : null;
                            showResult(
                                cached3 && cached3.human,
                                cached3 && cached3.bytes,
                                "Using cached result",
                                dur
                            );
                            stopStatusSpinner();
                            statusEl.style.display = "none";
                        }, 15000);
                    }
                }
            } catch (e) {
                if (isFresh || cached) {
                    // Keep showing cached and show a note about failure
                    noteEl.textContent = "Using cached result • refresh failed";
                    stopStatusSpinner();
                    statusEl.style.display = "none";
                } else {
                    showError(
                        "Failed to fetch: " +
                            (e && e.message ? e.message : String(e))
                    );
                }
            }
        };

        // Auto-fetch if not fresh
        if (!isFreshGood) {
            doFetch();
        }

        // Manual refresh
        refreshBtn.onclick = () => {
            startStatusSpinner("Refreshing");
            noteEl.textContent = "Refreshing…";
            doFetch();
        };

        // Options button already bound above

        // Live update: background prefetch completed
        try {
            chrome.runtime.onMessage.addListener(async (msg) => {
                if (!msg) return;
                if (msg.type === "yt_current_res") {
                    if (!msg.videoId || msg.videoId !== currentVideoId) return;
                    currentResLabel = msg.label || null;
                    currentItag = msg.itag || null;
                    currentDurationSec =
                        typeof msg.durationSec === "number" &&
                        isFinite(msg.durationSec) &&
                        msg.durationSec > 0
                            ? Math.round(msg.durationSec)
                            : currentDurationSec;
                    if (resultEl && resultEl.style.display !== "none") {
                        renderSizes(lastHumanMap, lastBytesMap);
                    }
                    return;
                }
                if (msg.type === "sizeCacheUpdated") {
                    if (msg.videoId && msg.videoId === currentVideoId) {
                        const cached2 = await readCache(currentVideoId);
                        const dur =
                            cached2 && cached2.human && cached2.human.duration
                                ? cached2.human.duration
                                : null;
                        showResult(
                            cached2 && cached2.human,
                            cached2 && cached2.bytes,
                            "Just updated",
                            dur
                        );
                        stopStatusSpinner();
                        statusEl.style.display = "none";
                        noteEl.textContent = "Just updated";
                    }
                } else if (msg.type === "sizeCacheFailed") {
                    // Stop spinner and attempt direct fetch fallback to avoid persistent N/A
                    stopStatusSpinner();
                    statusEl.style.display = "none";
                    try {
                        const msg2 = await callNativeHost(
                            currentUrl,
                            currentDurationSec || undefined
                        );
                        if (msg2 && msg2.ok) {
                            const dur =
                                msg2.human && msg2.human.duration
                                    ? msg2.human.duration
                                    : null;
                            await writeCache(currentVideoId, {
                                timestamp: Date.now(),
                                human: msg2.human || null,
                                bytes: msg2.bytes || null,
                            });
                            showResult(
                                msg2.human,
                                msg2.bytes,
                                "Just updated",
                                dur
                            );
                            noteEl.textContent = "Just updated";
                            return;
                        }
                    } catch (e) {
                        Logger.warn(
                            "Fallback direct host call failed in failure handler",
                            e
                        );
                    }
                    noteEl.textContent =
                        "Refresh failed" +
                        (msg && msg.error ? `: ${msg.error}` : "");
                }
            });
        } catch (e) {
            Logger.warn("Failed to add popup message listener", e);
        }
    } catch (e) {
        showError(
            "Unexpected error: " + (e && e.message ? e.message : String(e))
        );
    }
})();

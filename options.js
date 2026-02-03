/**
 * Options Page Script for YouTube Size Extension
 *
 * This script manages the extension's options/settings page where users can configure:
 * - Auto-prefetch behavior (enable/disable automatic size fetching)
 * - Cache TTL (time-to-live) in hours (1-48 hours)
 * - Badge display settings (show/hide status indicators)
 * - Video length display toggle
 * - Cloud API settings (enable/disable cloud service)
 * - Cloud API URL configuration
 * - Resolution selection (which resolutions to show in popup)
 *
 * Settings are persisted to chrome.storage.local and immediately affect
 * all extension components via storage.onChanged listeners.
 * @file Options page controller
 * @author YouTube Size Extension Team
 * @version 0.2.0
 */
/* global Logger */

(function () {
    /** @constant {Object} Default settings values */
    const defaultSettings = {
        autoPrefetch: true,
        ttlHours: 24,
        showBadge: true,
        showLength: true,
        useCloud: true,
        cloudApiUrl: "https://your-api.example.com/size",
        resolutions: ["480p", "720p", "1080p", "1440p"],
    };

    /**
     * Shorthand for document.getElementById
     * @param {string} id - Element ID
     * @returns {HTMLElement} The element
     */
    function $(id) {
        return document.getElementById(id);
    }

    /**
     *
     * @param keys
     */
    async function storageGet(keys) {
        return new Promise((resolve) =>
            chrome.storage.local.get(keys, resolve)
        );
    }
    /**
     *
     * @param items
     */
    async function storageSet(items) {
        return new Promise((resolve) =>
            chrome.storage.local.set(items, resolve)
        );
    }

    /**
     *
     * @param n
     * @param min
     * @param max
     */
    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    /**
     *
     * @param arr
     */
    function setResCheckboxes(arr) {
        const set = new Set(arr || []);
        const ids = [
            ["res_144", "144p"],
            ["res_240", "240p"],
            ["res_360", "360p"],
            ["res_480", "480p"],
            ["res_720", "720p"],
            ["res_1080", "1080p"],
            ["res_1440", "1440p"],
        ];
        for (const [id, label] of ids) {
            const el = $(id);
            if (el) el.checked = set.has(label);
        }
    }

    /**
     * Get selected resolutions in correct order (low to high)
     * @returns {string[]} Array of selected resolution labels
     */
    function getSelectedRes() {
        const res = [];
        if ($("res_144")?.checked) res.push("144p");
        if ($("res_240")?.checked) res.push("240p");
        if ($("res_360")?.checked) res.push("360p");
        if ($("res_480")?.checked) res.push("480p");
        if ($("res_720")?.checked) res.push("720p");
        if ($("res_1080")?.checked) res.push("1080p");
        if ($("res_1440")?.checked) res.push("1440p");
        return res;
    }

    /**
     * Loads saved settings from storage and populates the form
     * @async
     * @returns {Promise<void>}
     */
    async function load() {
        try {
            const obj = await storageGet(["ytSize_settings"]);
            const s = obj && obj.ytSize_settings ? obj.ytSize_settings : {};
            const cfg = Object.assign({}, defaultSettings, s);
            $("autoPrefetch").checked = !!cfg.autoPrefetch;
            $("ttlHours").value = String(cfg.ttlHours);
            $("showBadge").checked = !!cfg.showBadge;
            if (document.getElementById("showLength")) {
                $("showLength").checked = cfg.showLength !== false; // default true
            }
            if (document.getElementById("useCloud")) {
                $("useCloud").checked = !!cfg.useCloud;
            }
            if (document.getElementById("cloudApiUrl")) {
                $("cloudApiUrl").value = cfg.cloudApiUrl || "";
            }
            setResCheckboxes(cfg.resolutions || defaultSettings.resolutions);
        } catch (e) {
            Logger.warn("Failed to load settings in options", e);
        }
    }

    /**
     * Saves form values to storage
     *
     * Validates that at least one resolution is selected. If none are selected,
     * resets to default resolutions.
     * @async
     * @returns {Promise<void>}
     */
    async function save() {
        const ttl = clamp(
            parseInt($("ttlHours").value, 10) || defaultSettings.ttlHours,
            1,
            48
        );
        const selected = getSelectedRes();
        const obj = {
            autoPrefetch: !!$("autoPrefetch").checked,
            ttlHours: ttl,
            showBadge: !!$("showBadge").checked,
            showLength: !!$("showLength")?.checked,
            useCloud: !!$("useCloud")?.checked,
            cloudApiUrl: String($("cloudApiUrl")?.value || "").trim(),
            resolutions: selected,
        };
        const st = $("status");
        if (!selected || selected.length === 0) {
            // enforce at least one resolution; fall back to defaults
            obj.resolutions = defaultSettings.resolutions.slice();
            st.textContent =
                "At least one resolution is required. Reset to defaults (480p, 720p, 1080p, 1440p).";
            setTimeout(() => {
                st.textContent = "";
            }, 3000);
        }
        await storageSet({ ytSize_settings: obj });
        st.textContent = "Saved";
        setTimeout(() => {
            st.textContent = "";
        }, 1500);
    }

    /**
     * Resets all settings to default values
     * @async
     * @returns {Promise<void>}
     */
    async function resetDefaults() {
        await storageSet({ ytSize_settings: defaultSettings });
        await load();
        const st = $("status");
        st.textContent = "Reset to defaults";
        setTimeout(() => {
            st.textContent = "";
        }, 1500);
    }

    document.addEventListener("DOMContentLoaded", () => {
        load();
        $("save").addEventListener("click", save);
        $("reset").addEventListener("click", resetDefaults);
    });
})();

// Settings management for background service worker
/* eslint-disable jsdoc/require-jsdoc, no-unused-vars */
/* exported settingsReady, getSettings, defaultSettings */
/* global Logger */

const defaultSettings = {
    autoPrefetch: true,
    ttlHours: 24,
    showBadge: true,
    showLength: true,
    preferredMethod: "cloud",
    cloudApiUrl: "",
    cloudApiKey: "",
    resolutions: ["480p", "720p", "1080p", "1440p"],
};

let currentSettings = { ...defaultSettings };

async function loadSettings() {
    try {
        const obj = await new Promise((resolve) => {
            chrome.storage.local.get(["ytSize_settings"], resolve);
        });
        const stored = obj && obj.ytSize_settings ? obj.ytSize_settings : {};
        currentSettings = { ...defaultSettings, ...stored };

        // Merge packaged config.json if present
        try {
            const url = chrome.runtime.getURL("config.json");
            const res = await fetch(url);
            if (res && res.ok) {
                const cfg = await res.json();
                if (cfg && typeof cfg === "object") {
                    currentSettings = { ...currentSettings, ...cfg };
                }
            }
        } catch (e) {
            Logger.info("Optional config.json not found or invalid", e);
        }
    } catch (e) {
        Logger.error("Failed to load settings", e);
        currentSettings = { ...defaultSettings };
    }
}

const settingsReady = (async () => {
    await loadSettings();
    return currentSettings;
})();

function getSettings() {
    return currentSettings;
}

try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes && changes.ytSize_settings) {
            try {
                const nv = changes.ytSize_settings.newValue || {};
                currentSettings = { ...defaultSettings, ...nv };
            } catch (e) {
                Logger.warn("Failed to update settings", e);
            }
        }
    });
} catch (e) {
    Logger.warn("Failed to add storage listener", e);
}

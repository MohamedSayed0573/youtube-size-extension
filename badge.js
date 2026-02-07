// Badge handling for background service worker
/* eslint-disable jsdoc/require-jsdoc, no-unused-vars */
/* exported updateBadge, clearBadge */
/* global Logger */

const tabBadgeTimers = new Map();
const CLEAR_BADGE_MS = 8000;

function stopBadgeSpinner(tabId) {
    if (!tabBadgeTimers.has(tabId)) return;
    clearInterval(tabBadgeTimers.get(tabId));
    tabBadgeTimers.delete(tabId);
}

function setBadge(tabId, { text = "", color, title }) {
    if (typeof chrome.action === "undefined" || typeof tabId !== "number") {
        return;
    }
    try {
        chrome.action.setBadgeText({ tabId, text });
        if (color) chrome.action.setBadgeBackgroundColor({ tabId, color });
        if (title) chrome.action.setTitle({ tabId, title });
    } catch (e) {
        Logger.warn("Failed to set badge", e);
    }
}

function startBadgeSpinner(tabId) {
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

function updateBadge(tabId, state, options = {}) {
    const { showBadge = true } = options;
    if (
        !showBadge ||
        typeof tabId !== "number" ||
        typeof chrome.action === "undefined"
    ) {
        return;
    }

    if (state === "loading") {
        startBadgeSpinner(tabId);
        return;
    }

    if (state === "ok") {
        stopBadgeSpinner(tabId);
        setBadge(tabId, {
            text: "\u2713",
            color: "#27ae60",
            title: "YouTube Size cached",
        });
        return;
    }

    if (state === "error") {
        stopBadgeSpinner(tabId);
        setBadge(tabId, {
            text: "!",
            color: "#e74c3c",
            title: "YouTube Size prefetch failed",
        });
        setTimeout(() => {
            try {
                setBadge(tabId, { text: "" });
            } catch (e) {
                Logger.warn("Failed to clear error badge", e);
            }
        }, CLEAR_BADGE_MS);
        return;
    }

    // default: clear
    stopBadgeSpinner(tabId);
    setBadge(tabId, { text: "" });
}

function clearBadge(tabId) {
    updateBadge(tabId, "clear", { showBadge: true });
}

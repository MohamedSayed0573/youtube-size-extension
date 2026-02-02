/**
 * Cloud API Server for YouTube Size Extension
 *
 * This Node.js/Express server provides an HTTP API for fetching YouTube video
 * size information using yt-dlp. It serves as an alternative to the native
 * messaging host, allowing users to deploy the service on a cloud platform.
 *
 * Key features:
 * - RESTful API endpoint for size extraction
 * - Supports duration hints to optimize yt-dlp calls
 * - Extracts multiple resolutions (144p-1440p)
 * - Handles multiple codec variants (H.264, VP9, AV1)
 * - CORS enabled for browser extension requests
 * - Timeout protection (25 seconds)
 * - Comprehensive error handling
 *
 * Endpoint:
 *   POST /size
 *   Body: { url: string, duration_hint?: number }
 *   Response: { ok: boolean, bytes: Object, human: Object, duration: number }
 *
 * @fileoverview Cloud API server for yt-dlp size extraction
 * @author YouTube Size Extension Team
 * @version 1.0.0
 */

const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for extension requests
app.use(cors());
app.use(express.json());

// Map of interesting format ids by resolution
const VIDEO_FORMAT_IDS = {
    "144p": ["394"],
    "240p": ["395"],
    "360p": ["396"],
    "480p": ["397"],
    "720p": ["398"],
    "1080p": ["399", "299", "303"],
    "1440p": ["400", "308"],
};
const AUDIO_FALLBACK_ID = "251";

/**
 * Converts bytes to human-readable format using decimal (SI) units
 *
 * @param {number} n - Number of bytes
 * @returns {string|null} Formatted string (e.g., "45.32 MB") or null if invalid
 */
function humanizeBytes(n) {
    if (!n || n <= 0) return null;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
        v /= 1000;
        i++;
    }
    return i === 0
        ? `${Math.round(v)} ${units[i]}`
        : `${v.toFixed(2)} ${units[i]}`;
}

/**
 * Converts seconds to H:MM:SS or M:SS format
 *
 * @param {number} seconds - Duration in seconds
 * @returns {string|null} Formatted duration string or null if invalid
 */
function humanizeDuration(seconds) {
    if (!seconds || seconds <= 0) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0)
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function pickFirst(...vals) {
    for (const v of vals) {
        if (v != null && v > 0) return v;
    }
    return null;
}

/**
 * Calculates file size from a yt-dlp format object
 *
 * Prefers exact filesize, falls back to filesize_approx, then estimates
 * from bitrate (tbr) and duration.
 *
 * @param {Object} fmt - The format object from yt-dlp JSON output
 * @param {number} durationSec - Video duration in seconds
 * @returns {number|null} Estimated size in bytes or null
 */
function sizeFromFormat(fmt, durationSec) {
    if (!fmt) return null;

    const fs = pickFirst(fmt.filesize, fmt.filesize_approx);
    if (fs) return Math.round(fs);

    // Estimate from TBR if filesize missing
    try {
        const tbr = fmt.tbr; // in kbps
        if (tbr && durationSec && durationSec > 0) {
            return Math.round(((tbr * 1000.0) / 8.0) * durationSec);
        }
    } catch (e) {
        // ignore
    }
    return null;
}

/**
 * Extracts video metadata from YouTube using yt-dlp
 *
 * Runs yt-dlp with -J flag to get complete metadata in JSON format.
 * Includes timeout protection and error handling.
 *
 * WARNING: This function executes shell commands. The URL should be
 * validated before calling this function to prevent command injection.
 *
 * @async
 * @param {string} url - The YouTube video URL
 * @returns {Promise<Object>} Parsed JSON metadata from yt-dlp
 * @throws {Error} If yt-dlp fails or times out
 */
async function extractInfo(url) {
    // Use yt-dlp to extract metadata in JSON format
    const escapedUrl = url.replace(/"/g, '\\"');
    const cmd = `yt-dlp -J --skip-download "${escapedUrl}"`;

    try {
        const { stdout, stderr } = await execAsync(cmd, {
            timeout: 25000,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        if (stderr) {
            console.error("yt-dlp stderr:", stderr);
        }

        return JSON.parse(stdout);
    } catch (error) {
        if (error.killed) {
            throw new Error("yt-dlp timed out while fetching metadata");
        }
        throw new Error(`Failed to fetch metadata: ${error.message}`);
    }
}

/**
 * Computes video sizes for all resolutions from yt-dlp metadata
 *
 * Analyzes the formats array from yt-dlp JSON output to calculate
 * combined sizes (video + audio) for each resolution tier.
 *
 * Handles:
 * - Multiple codec variants (H.264/VP9/AV1 for 1080p/1440p)
 * - Audio track combination (typically format 251)
 * - Duration fallback to hint if metadata missing
 *
 * @param {Object} meta - The complete metadata object from yt-dlp
 * @param {number} [durationHint] - Optional duration hint in seconds
 * @returns {Object} Result object with ok, bytes, human, and duration fields
 * @throws {Error} If no size information could be determined
 */
function computeSizes(meta, durationHint) {
    const formats = meta.formats || [];

    let durationSec = null;
    try {
        const dur = meta.duration;
        if (typeof dur === "number") {
            durationSec = Math.round(dur);
        }
    } catch (e) {
        // ignore
    }

    if (!durationSec && typeof durationHint === "number" && durationHint > 0) {
        durationSec = Math.round(durationHint);
    }

    // Build index of formats by itag/id
    const byId = {};
    for (const f of formats) {
        const fid = f.format_id != null ? String(f.format_id) : null;
        if (fid) {
            byId[fid] = f;
        }
    }

    // Audio size
    const audioSize = sizeFromFormat(byId[AUDIO_FALLBACK_ID], durationSec);

    // Initialize output
    const bytesOut = {
        s144p: null,
        s240p: null,
        s360p: null,
        s480p: null,
        s720p: null,
        s1080p: null,
        s1440p: null,
        s1080p_299: null,
        s1080p_303: null,
        s1080p_399: null,
        s1440p_308: null,
        s1440p_400: null,
    };

    // For each resolution, pick a candidate video id and compute combined size with audio
    for (const [label, ids] of Object.entries(VIDEO_FORMAT_IDS)) {
        let vidSize = null;
        let chosenId = null;

        for (const fid of ids) {
            const sz = sizeFromFormat(byId[fid], durationSec);
            if (sz) {
                vidSize = sz;
                chosenId = fid;
                break;
            }
        }

        if (chosenId && vidSize) {
            const key = `s${label}`;
            bytesOut[key] =
                audioSize && label.includes("p")
                    ? vidSize + audioSize
                    : vidSize;

            // Expose specific combos for 1080p and 1440p
            if (label === "1080p") {
                for (const fid of ["299", "303", "399"]) {
                    const sz = sizeFromFormat(byId[fid], durationSec);
                    if (sz) {
                        bytesOut[`s1080p_${fid}`] = audioSize
                            ? sz + audioSize
                            : sz;
                    }
                }
            }
            if (label === "1440p") {
                for (const fid of ["308", "400"]) {
                    const sz = sizeFromFormat(byId[fid], durationSec);
                    if (sz) {
                        bytesOut[`s1440p_${fid}`] = audioSize
                            ? sz + audioSize
                            : sz;
                    }
                }
            }
        }
    }

    // Convert to human-readable
    const humanOut = {};
    for (const [k, v] of Object.entries(bytesOut)) {
        humanOut[k] = humanizeBytes(v);
    }
    humanOut.duration = humanizeDuration(durationSec);

    // Check if we got any sizes
    const hasAny = Object.values(bytesOut).some((v) => v != null);
    if (!hasAny) {
        throw new Error(
            "No size information could be determined from yt-dlp output",
        );
    }

    return {
        ok: true,
        bytes: bytesOut,
        human: humanOut,
        duration: durationSec,
    };
}

// Health check endpoint
app.get("/", (req, res) => {
    res.json({ ok: true, service: "ytdlp-sizer-api" });
});

// Main size extraction endpoint
app.post("/size", async (req, res) => {
    try {
        const { url, duration_hint } = req.body;

        if (!url) {
            return res
                .status(400)
                .json({ ok: false, error: "URL is required" });
        }

        // Extract metadata using yt-dlp
        const meta = await extractInfo(url);

        // Compute sizes
        const result = computeSizes(meta, duration_hint);

        res.json(result);
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(error.message.includes("timed out") ? 504 : 502).json({
            ok: false,
            error: error.message,
        });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
        ok: false,
        error: "Internal server error",
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`ytdlp-sizer-api listening on port ${PORT}`);
});

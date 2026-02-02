# YouTube Size via yt-dlp (Chrome/Firefox Extension)

## Overview

This extension shows the estimated total download sizes for configurable video resolutions (144p to 1080p) when clicked on a YouTube video page. It uses a Native Messaging host that runs `yt-dlp -F <url>` and parses the format list for multiple resolutions:

## How It Works

The extension calculates video sizes by combining video-only and audio-only formats:

- 480p size = size(format id `397`, video-only) + size(format id `251`, audio-only)
- 720p size = size(format id `398`, video-only) + size(format id `251`, audio-only)

## Features

- Simple popup UI with two lines: `480p: <size>` and `720p: <size>`
- Uses yt-dlp to read available formats and sizes
- Linux install script for the native messaging host
- Configurable TTL for cache expiration
- Action badge indicates prefetch status
- Configurable resolution options (144p, 240p, 360p, 480p, 720p, 1080p)
- Live updates in popup from background cache updates
- Video formats: 144p (394), 240p (395), 360p (396), 480p (397), 720p (398), 1080p (399) + audio-only (251)
- Video length displayed at the bottom of the popup

## Requirements

### Native Host Option (Recommended):

- Windows or Linux
- Chrome/Chromium or Firefox (Firefox 109+ for MV3)
- Python 3 (for the native messaging host)
- `yt-dlp` installed and available in PATH

### Cloud API Option (Alternative):

- Deploy the Node.js server from `cloud_api/` folder
- No local installation required for users
- See `cloud_api/README_NODE.md` for deployment instructions

## Setup

### Chrome/Chromium on Linux

1. Load the extension
    - Open `chrome://extensions`.
    - Enable Developer mode.
    - Click "Load unpacked" and select this folder.
    - Note the extension ID displayed (you will need it for native messaging).

2. Install the native host
    - Open a terminal and run:
        ```bash
        ./native_host/install_host.sh <CHROME_EXTENSION_ID>
        ```
    - The script installs for both Chrome and Chromium and also installs a Firefox manifest under `~/.mozilla/native-messaging-hosts/`.

### Chrome or Edge on Windows

1. Load the extension (unpacked)
    - Chrome: `chrome://extensions` → Developer mode → Load unpacked → select this folder.
    - Edge: `edge://extensions` → Developer mode → Load unpacked → select this folder.

2. Install the native host
    - Ensure the path in `native_host/com.ytdlp.sizer.json` has `allowed_origins` for your actual Chrome/Edge extension ID. Edit the file if needed after loading the extension and noting the ID.
    - Double-click `native_host/install_host.reg` to add the Native Messaging registry keys.

Note: On Windows the registry entries point to the JSON files in `d:\extention\native_host\`. If you place the project elsewhere, update the `.reg` file accordingly before applying.

### Firefox on Windows

1. Load the extension temporarily
    - Open `about:debugging#/runtime/this-firefox`.
    - Click "Load Temporary Add-on…" and select this folder’s `manifest.json`.
    - The add-on uses a fixed ID declared in `manifest.json`:
        - `browser_specific_settings.gecko.id = ytdlp-sizer@example.com`

2. Install the native host
    - Double-click `native_host/install_host.reg` (it adds the key `HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\com.ytdlp.sizer`).
    - The Firefox-specific manifest is `native_host/com.ytdlp.sizer.firefox.json` and uses `allowed_extensions: ["ytdlp-sizer@example.com"]`.

### Firefox on Linux

1. Load the extension temporarily
    - Open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on… → select `manifest.json`.

2. Install the native host
    - The same installer script also installs the Firefox manifest:
        ```bash
        ./native_host/install_host.sh <ANY_CHROME_ID>
        ```
    - The Firefox part does not need an ID; it uses the fixed Gecko ID from `manifest.json`.

### Verify and use

- Navigate to a YouTube video page and click the extension icon.
- The popup shows sizes for your configured resolutions; it auto-refreshes when the background prefetch completes.
- The action badge indicates prefetch status.

## Troubleshooting

- "Failed to connect to native host":
    - Linux/Chrome: ensure you ran `native_host/install_host.sh <CHROME_ID>` with the correct ID, then restart the browser.
    - Windows/Chrome: ensure `native_host/com.ytdlp.sizer.json` contains your actual extension ID under `allowed_origins`.
    - Firefox/Linux: verify `~/.mozilla/native-messaging-hosts/com.ytdlp.sizer.json` exists.
    - Firefox/Windows: verify the registry key exists at `HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\com.ytdlp.sizer` and points to the Firefox JSON.

- "yt-dlp not found":
    - Install `yt-dlp` and make sure it is in PATH.

- Missing sizes / N/A:
    - Some formats may not have a listed size in `yt-dlp -F` output. The popup will show `N/A` if 397/398 or 251 is missing.

## Security Notes

- The native host accepts only a URL string and returns computed sizes.
- The extension requires `nativeMessaging` permission to talk to the host, and `activeTab`/`tabs` to read the current tab URL.

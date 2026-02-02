# Developer Guide - YouTube Size Extension

Welcome to the YouTube Size extension development guide! This document will help you understand the codebase, set up your development environment, and contribute effectively.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Code Style Guide](#code-style-guide)
5. [Common Development Tasks](#common-development-tasks)
6. [Testing Guidelines](#testing-guidelines)
7. [Debugging Tips](#debugging-tips)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js** (v18+ for cloud API development)
- **Python 3** (for native host development)
- **yt-dlp** installed and in your PATH
- **Chrome** or **Firefox** browser (for testing)
- **Git** for version control

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd extention

# For cloud API development
cd cloud_api
npm install

# Install the extension in Chrome
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the extension directory

# Install native host (Linux)
cd native_host
./install_host.sh YOUR_CHROME_EXTENSION_ID
```

---

## Development Setup

### Setting Up the Extension

1. **Load the Extension**
    - Chrome: Navigate to `chrome://extensions`
    - Enable "Developer mode" (top-right toggle)
    - Click "Load unpacked"
    - Select the extension root directory

2. **Note Your Extension ID**
    - The ID is displayed under the extension name
    - You'll need this for native host configuration

3. **Configure Native Host**

    ```bash
    # Linux/Mac
    cd native_host
    ./install_host.sh <YOUR_EXTENSION_ID>

    # Windows
    # Edit native_host/install_host.reg to include your extension ID
    # Then double-click the .reg file
    ```

### Setting Up the Cloud API (Optional)

```bash
cd cloud_api

# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Or run in production mode
npm start
```

The API will be available at `http://localhost:3000`

**Configure in Extension:**

1. Click the extension icon → Options
2. Check "Use cloud service"
3. Enter `http://localhost:3000/size` in Cloud API URL
4. Save

---

## Project Structure

```
extention/
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Background service worker (577 lines)
├── content.js              # Content script for YouTube pages (200 lines)
├── popup.html              # Popup UI structure
├── popup.js                # Popup logic (696 lines)
├── options.html            # Options page structure
├── options.js              # Options page logic (102 lines)
├── youtube.png             # Extension icon
├── README.md               # User-facing documentation
├── ARCHITECTURE.md         # System architecture documentation
├── API_REFERENCE.md        # API documentation
├── DEVELOPER_GUIDE.md      # This file
│
├── native_host/            # Native messaging host (Python)
│   ├── ytdlp_host.py       # Main Python script (643 lines)
│   ├── install_host.sh     # Linux installation script
│   ├── install_host.reg    # Windows registry configuration
│   └── *.json              # Native messaging manifests
│
└── cloud_api/              # Node.js API server
    ├── server.js           # Express API (257 lines)
    ├── package.json        # Node.js dependencies
    └── Dockerfile          # Container configuration
```

---

## Code Style Guide

### JavaScript

**File Headers:**

```javascript
/**
 * [Brief description of file purpose]
 *
 * [Detailed description of responsibilities]
 *
 * @fileoverview [Short summary]
 * @author YouTube Size Extension Team
 * @version 0.2.0
 */
```

**Function Documentation:**

```javascript
/**
 * [Brief description of what the function does]
 *
 * [More detailed explanation if needed]
 *
 * @async
 * @param {string} videoId - Description of parameter
 * @param {number} [optional] - Optional parameter
 * @returns {Promise<Object>} Description of return value
 * @throws {Error} When this error occurs
 * @example
 *   const result = await myFunction('abc123');
 */
async function myFunction(videoId, optional) {
    // Implementation
}
```

**Naming Conventions:**

- Functions: `camelCase` (e.g., `prefetchForUrl`, `isFreshInCache`)
- Variables: `camelCase` (e.g., `videoId`, `currentTabId`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `HOST_NAME`, `CLEAR_BADGE_MS`)
- Private helpers: prefix with `_` (e.g., `_dbg`, `_get_num`)

**Error Handling:**

```javascript
// ✅ Good: Specific error handling
try {
    const result = await fetchData();
    return result;
} catch (error) {
    console.error("Failed to fetch data:", error.message);
    throw new Error(`Fetch failed: ${error.message}`);
}

// ❌ Avoid: Silent failures
try {
    await fetchData();
} catch (_) {
    // Don't silently ignore errors in business logic
}
```

### Python

**Function Documentation:**

```python
def my_function(video_id: str, duration_hint: Optional[int] = None) -> dict:
    """Brief description of what the function does.

    More detailed explanation if needed.

    Args:
        video_id: Description of parameter
        duration_hint: Optional parameter description

    Returns:
        Dictionary containing result data with keys:
        - 'ok': Boolean success flag
        - 'data': Result data

    Raises:
        ValueError: When video_id is invalid

    Example:
        result = my_function('dQw4w9WgXcQ', 332)
        print(result['data'])
    """
    # Implementation
```

**Type Hints:**

```python
from typing import Optional, List, Dict, Any

def process_formats(
    formats: List[Dict[str, Any]],
    duration: Optional[int] = None
) -> Dict[str, int]:
    """Always use type hints for function signatures."""
    pass
```

---

## Common Development Tasks

### Adding a New Resolution

1. **Update Format ID Mappings** (`background.js`, `cloud_api/server.js`, `native_host/ytdlp_host.py`):

```javascript
const VIDEO_FORMAT_IDS = {
    "144p": ["394"],
    "240p": ["395"],
    // ... existing resolutions
    "2160p": ["401"], // Add new resolution
};
```

2. **Update Cache Structure**:

```javascript
// In all files that define cache keys
const keys = [
    "s144p",
    "s240p",
    "s360p",
    "s480p",
    "s720p",
    "s1080p",
    "s1440p",
    "s2160p", // Add here
];
```

3. **Update Options Page** (`options.html`, `options.js`):

```html
<label><input type="checkbox" id="res_2160" /> 2160p</label>
```

4. **Update Size Computation**:
    - `ytdlp_host.py`: Add to `heights` list
    - `server.js`: Add to `VIDEO_FORMAT_IDS` and `bytesOut`
    - Test with actual YouTube videos that support the resolution

### Adding a New Codec Variant

For 1080p and 1440p, we expose specific codec variants (H.264, VP9, AV1).

1. **Native Host** (`ytdlp_host.py`):

```python
# Add format ID to extraction
f701 = fmt_by_id('701')  # New codec
video_only['v701'] = _filesize_from_fmt(f701, duration_sec) if f701 else None

# Add to response
"v701": v_new_codec,
```

2. **Popup Display** (`popup.js`):

```javascript
if (r === "1080p") {
    variantDefs = [
        { key: "s1080p_299", codec: "H.264", itag: "299" },
        { key: "s1080p_303", codec: "VP9", itag: "303" },
        { key: "s1080p_399", codec: "AV1", itag: "399" },
        { key: "s1080p_701", codec: "NEW", itag: "701" }, // Add here
    ];
}
```

### Changing the Cache TTL Default

1. **Update Default** (`background.js`, `options.js`, `popup.js`):

```javascript
const defaultSettings = {
    // ... other settings
    ttlHours: 48, // Changed from 24 to 48
};
```

2. **Update Documentation**:
    - `README.md`: Update feature description
    - `API_REFERENCE.md`: Update Storage Schema section
    - `ARCHITECTURE.md`: Update Storage Strategy section

### Adding a New Settings Option

1. **Define Default** (in all three files: `background.js`, `options.js`, `popup.js`):

```javascript
const defaultSettings = {
    // ... existing settings
    newFeature: false, // Add new setting
};
```

2. **Add UI Control** (`options.html`):

```html
<div class="row">
    <label>
        <input type="checkbox" id="newFeature" />
        Enable New Feature
    </label>
</div>
```

3. **Wire Up** (`options.js`):

```javascript
async function load() {
    // ... existing loads
    $("newFeature").checked = !!cfg.newFeature;
}

async function save() {
    const obj = {
        // ... existing settings
        newFeature: !!$("newFeature").checked,
    };
    // ... save logic
}
```

4. **Use in Components**:

```javascript
// background.js
if (settings.newFeature) {
    // Implement feature logic
}
```

---

## Testing Guidelines

### Manual Testing Checklist

**Basic Functionality:**

- [ ] Extension icon appears in toolbar
- [ ] Clicking icon on YouTube video shows popup
- [ ] Sizes display correctly for at least one resolution
- [ ] Manual refresh button works
- [ ] Options page opens and saves settings
- [ ] Badge indicator shows during prefetch

**Edge Cases:**

- [ ] Test on video with no 1080p available
- [ ] Test on very short video (<30 seconds)
- [ ] Test on very long video (>3 hours)
- [ ] Test on live stream (should handle gracefully)
- [ ] Test on private video (should show error)
- [ ] Test on age-restricted video
- [ ] Test on non-YouTube page (should show error)

**Performance:**

- [ ] Cache works (second open is instant)
- [ ] No duplicate requests for same video
- [ ] Badge clears after fetch completes
- [ ] No memory leaks after browsing 50+ videos

**Cross-Browser:**

- [ ] Test on Chrome
- [ ] Test on Chromium
- [ ] Test on Edge
- [ ] Test on Firefox (temporary load)

### Testing Native Host

```bash
# Test the Python script directly
echo '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}' | python3 ytdlp_host.py

# Check for errors in stderr
echo '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}' | python3 ytdlp_host.py 2>errors.log

# Test with duration hint
echo '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ","duration_hint":212}' | python3 ytdlp_host.py
```

### Testing Cloud API

```bash
# Start server
cd cloud_api
npm start

# Test health check
curl http://localhost:3000/

# Test size endpoint
curl -X POST http://localhost:3000/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}'

# Test with duration hint
curl -X POST http://localhost:3000/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ","duration_hint":212}'
```

---

## Debugging Tips

### Chrome DevTools

**Background Worker:**

```
chrome://extensions → Find your extension → Service worker (blue link)
```

This opens DevTools for the background worker. Here you can:

- Set breakpoints in `background.js`
- View console logs
- Inspect storage (`Application` tab → Storage)

**Popup:**

```
Right-click extension icon → Inspect popup
```

This opens DevTools for the popup window.

**Content Script:**

```
Open YouTube video → F12 → Console
Filter by "content.js" to see content script logs
```

### Common Debug Patterns

**Trace Message Flow:**

```javascript
// In background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[BG] Received message:", msg.type, msg);
    // ... rest of handler
});

// In popup.js
chrome.runtime.sendMessage(msg, (response) => {
    console.log("[POPUP] Response:", response);
});

// In content.js
chrome.runtime.sendMessage(msg, () => {
    console.log("[CONTENT] Message sent:", msg.type);
});
```

**Inspect Storage:**

```javascript
// In DevTools console (background context)
chrome.storage.local.get(null, (data) => console.log("Local storage:", data));
chrome.storage.session.get(null, (data) =>
    console.log("Session storage:", data),
);

// Clear cache for testing
chrome.storage.session.clear(() => console.log("Cache cleared"));
```

**Monitor Badge Changes:**

```javascript
// In background.js, add temporary logging
function setBadgeCheck(tabId) {
    console.log("[BADGE] Setting check for tab", tabId);
    // ... rest of function
}
```

### Python Debugging

**Add Debug Logging:**

```python
# ytdlp_host.py
import sys

def _dbg(msg: str):
    sys.stderr.write(f"[DEBUG] {msg}\n")
    sys.stderr.flush()

# Use throughout code
_dbg(f"Video ID: {video_id}")
_dbg(f"Formats found: {len(formats)}")
```

**View Logs:**

```bash
# Linux
tail -f ~/.config/google-chrome/NativeMessagingHosts/ytdlp_debug.log

# Or redirect stderr when testing
echo '{"url":"..."}' | python3 ytdlp_host.py 2>debug.log
```

### Network Debugging

**Cloud API Requests:**

```
Chrome DevTools → Network tab → Filter: size
```

Inspect request/response for cloud API calls.

**Native Host (doesn't use network)**
Native host communication goes through stdin/stdout, so use stderr logging.

---

## Troubleshooting

### "Failed to connect to native host"

**Causes:**

1. Native host not installed
2. Wrong extension ID in manifest
3. Python not in PATH
4. Manifest JSON syntax error

**Solutions:**

```bash
# Verify manifest exists
ls ~/.config/google-chrome/NativeMessagingHosts/com.ytdlp.sizer.json

# Check manifest content
cat ~/.config/google-chrome/NativeMessagingHosts/com.ytdlp.sizer.json

# Verify extension ID matches
grep allowed_origins ~/.config/google-chrome/NativeMessagingHosts/com.ytdlp.sizer.json

# Test Python script directly
echo '{"url":"https://youtube.com/watch?v=test"}' | python3 native_host/ytdlp_host.py
```

### "yt-dlp not found"

**Solution:**

```bash
# Install yt-dlp
pip3 install --user yt-dlp

# Verify installation
which yt-dlp
yt-dlp --version

# Add to PATH if needed
export PATH="$HOME/.local/bin:$PATH"
```

### Sizes show "N/A"

**Causes:**

1. yt-dlp timeout
2. Video unavailable (private, deleted, geo-blocked)
3. YouTube changed format IDs
4. No matching formats found

**Debug:**

```bash
# Run yt-dlp manually
yt-dlp -F "https://youtube.com/watch?v=VIDEO_ID"

# Check for specific format
yt-dlp -F "https://youtube.com/watch?v=VIDEO_ID" | grep "399"

# Get JSON output
yt-dlp -J "https://youtube.com/watch?v=VIDEO_ID" | jq '.formats[] | select(.format_id == "399")'
```

### Cache Not Updating

**Check:**

1. TTL hasn't expired yet
2. Auto-prefetch is enabled
3. Extension has permission for the tab

**Force Refresh:**

```javascript
// In background worker DevTools console
chrome.storage.session.clear(() => console.log("Cache cleared"));

// Then navigate to video again
```

### Cloud API Not Responding

**Check:**

1. Server is running (`npm start`)
2. Correct URL in options (include `/size` endpoint)
3. CORS not blocking request
4. yt-dlp installed on server

**Debug:**

```bash
# Check server logs
npm start  # Watch for errors

# Test endpoint directly
curl -v http://localhost:3000/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=test"}'
```

---

## Contributing Workflow

1. **Create a branch** for your feature/fix

    ```bash
    git checkout -b feature/my-new-feature
    ```

2. **Make changes** following the code style guide

3. **Add documentation** for new functions and features

4. **Test thoroughly** using the testing checklist

5. **Commit with clear messages**

    ```bash
    git commit -m "Add support for 2160p resolution

    - Added format ID 401 to mappings
    - Updated options page with 2160p checkbox
    - Updated cache structure
    - Tested on 4K YouTube videos"
    ```

6. **Create pull request** with:
    - Description of changes
    - Testing performed
    - Screenshots (for UI changes)
    - Breaking changes (if any)

---

## Useful Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Native Messaging](https://developer.chrome.com/docs/apps/nativeMessaging/)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp#readme)
- [YouTube Format IDs](https://gist.github.com/sidneys/7095afe4da4ae58694d128b1034e01e2)

---

**Last Updated**: February 2, 2026
**Version**: 0.2.0

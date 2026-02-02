# YouTube Size Extension - Architecture Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Component Details](#component-details)
4. [Data Flow](#data-flow)
5. [Storage Strategy](#storage-strategy)
6. [Error Handling](#error-handling)
7. [Performance Considerations](#performance-considerations)

## Overview

The YouTube Size extension is a cross-browser (Chrome/Firefox) extension that displays estimated download sizes for YouTube videos at various resolutions. The architecture is designed with multiple fallback strategies to ensure reliability across different deployment scenarios.

### Key Design Principles
- **Separation of Concerns**: Clear boundaries between UI, background logic, and data fetching
- **Progressive Enhancement**: Shows estimates quickly, then updates with exact data
- **Graceful Degradation**: Multiple fallback paths if primary methods fail
- **Cross-browser Compatibility**: Works on Chrome, Chromium, Edge, and Firefox

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Browser Extension                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Popup UI   │    │   Content    │    │  Background  │      │
│  │  (popup.js)  │◄───┤    Script    │◄───┤   Worker     │      │
│  │              │    │ (content.js) │    │(background.js)│      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                    │              │
│         │                   │                    │              │
│         └───────────────────┴────────────────────┘              │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
        ┌─────────▼─────────┐   ┌────────▼────────┐
        │  Native Host      │   │   Cloud API     │
        │  (Python)         │   │   (Node.js)     │
        │  ytdlp_host.py    │   │   server.js     │
        └─────────┬─────────┘   └────────┬────────┘
                  │                      │
                  └──────────┬───────────┘
                             │
                     ┌───────▼────────┐
                     │    yt-dlp      │
                     │  (CLI Tool)    │
                     └────────────────┘
```

## Component Details

### 1. Background Service Worker (`background.js`)

**Purpose**: Central orchestrator for data fetching, caching, and badge management.

**Key Responsibilities**:
- Auto-prefetch video sizes when YouTube pages load
- Manage size data cache with configurable TTL
- Update browser action badge to show status
- Coordinate between native host and cloud API
- Handle settings synchronization

**Key Functions**:
```javascript
prefetchForUrl(url, tabId, forced)  // Main prefetch orchestration
callNativeHost(url, durationHint)   // Native messaging communication
callCloudApi(url, durationHint)     // Cloud API communication
isFreshInCache(videoId)             // Cache freshness validation
```

**State Management**:
- `inFlight` Set: Prevents duplicate requests for same video
- `lastFetchMs` Map: Rate limiting per video ID
- `durationHints` Map: Caches video durations (1-hour TTL)
- `tabBadgeTimers` Map: Badge animation timers per tab

### 2. Content Script (`content.js`)

**Purpose**: Detects video metadata changes and monitors current playback state.

**Key Responsibilities**:
- Extract current video resolution (videoHeight → "720p")
- Extract current codec/format (itag from URL parameters)
- Monitor video metadata changes (resolution switches)
- Detect SPA navigation (YouTube doesn't reload pages)
- Report duration hints to background

**Detection Strategies**:
1. **Video Element Inspection**: Direct `video.videoHeight` reading
2. **URL Parameter Parsing**: Extract `itag` from `video.currentSrc`
3. **Event Listeners**: Monitor `loadedmetadata`, `resize`, `play`, `seeked`
4. **SPA Navigation**: 
   - YouTube custom events (`yt-navigate-finish`, `yt-page-data-updated`)
   - Polling fallback (checks `location.href` every 1.5s)

**Why Polling?**: YouTube's SPA sometimes misses events; polling ensures reliability.

### 3. Popup UI (`popup.js`)

**Purpose**: Display size information with fast initial estimates and live updates.

**Key Features**:
- Shows codec variants (H.264, VP9, AV1) for 1080p and 1440p
- Indicates currently playing resolution
- Provides manual refresh button
- Links to options page

**Loading Strategy**:
```
1. Check cache (instant display if fresh)
   ↓
2. Show estimates based on duration (if cache stale)
   ↓
3. Trigger background prefetch
   ↓
4. Update UI when exact data arrives
```

**Size Estimates**:
Uses average bitrates per resolution:
- 144p: 0.1 Mbps
- 240p: 0.3 Mbps
- 360p: 0.6 Mbps
- 480p: 1.2 Mbps
- 720p: 2.5 Mbps
- 1080p: 5.5 Mbps
- 1440p: 9.0 Mbps

Formula: `bytes = (Mbps × 1,000,000 / 8) × duration_seconds`

### 4. Native Messaging Host (`ytdlp_host.py`)

**Purpose**: Python script that executes yt-dlp and returns structured size data.

**Protocol**: Chrome Native Messaging
- Input: 4-byte length + JSON message via stdin
- Output: 4-byte length + JSON response via stdout
- Errors: Logged to stderr

**Execution Strategies**:
1. **JSON Dump** (`-J` flag): Comprehensive metadata in one call
2. **Format List** (`-F` flag): Fallback if JSON fails
3. **Duration Fetch** (`--print duration`): Separate call if needed

**Why Multiple Strategies?**: 
- `-J` is comprehensive but slower
- `-F` is faster but less detailed
- Duration fetch can be skipped if hint provided by content script

**Size Calculation**:
```
Total Size = Video Track Size + Audio Track Size

Video tracks by resolution:
- 144p: format 394 (video-only)
- 240p: format 395 (video-only)
- 360p: format 396 (video-only)
- 480p: format 397 (video-only)
- 720p: format 398 (video-only)
- 1080p: formats 299 (H.264), 303 (VP9), 399 (AV1)
- 1440p: formats 308 (VP9), 400 (AV1)

Audio track: format 251 (Opus, typically)
```

### 5. Cloud API Server (`cloud_api/server.js`)

**Purpose**: Optional Node.js/Express server for users who can't install native host.

**Endpoints**:
- `GET /`: Health check
- `POST /size`: Fetch video size data
  - Body: `{ url: string, duration_hint?: number }`
  - Response: `{ ok: boolean, bytes: Object, human: Object, duration: number }`

**Advantages**:
- No local yt-dlp installation required
- Can be deployed to cloud platforms (Railway, Heroku, etc.)
- Centralized updates

**Security Considerations**:
⚠️ **CRITICAL**: The current implementation has a command injection vulnerability. The URL is passed to `exec()` with insufficient sanitization. Production deployments should:
1. Use `execFile()` instead of `exec()`
2. Implement rate limiting
3. Add API authentication
4. Validate URLs against allowlist

## Data Flow

### 1. Auto-Prefetch Flow (Background)

```
User navigates to YouTube video
    ↓
Content script detects navigation
    ↓
Sends message to background worker
    ↓
Background checks if autoPrefetch enabled
    ↓
Checks if data is fresh in cache
    ↓ (if not fresh)
Calls native host or cloud API
    ↓
Parses response and stores in cache
    ↓
Updates browser action badge (✓)
    ↓
Sends update message to open popups
```

### 2. Manual Refresh Flow (Popup)

```
User clicks extension icon
    ↓
Popup opens and checks current tab URL
    ↓
Reads cache for video ID
    ↓
If fresh: Display immediately
If stale: Show cached + "refreshing..."
If missing: Show estimates (if duration known) or spinner
    ↓
Request background to prefetch (forced=true)
    ↓
Background fetches new data
    ↓
Popup receives update message
    ↓
UI refreshes with exact data
```

### 3. Resolution Detection Flow (Content → Popup)

```
Video plays or quality changes
    ↓
Content script reads video.videoHeight
    ↓
Maps height to resolution label (e.g., 1080 → "1080p")
    ↓
Extracts itag from video.currentSrc
    ↓
Sends message to background
    ↓
Background stores duration hint
    ↓
If popup is open:
    ↓
Popup receives message via onMessage listener
    ↓
Updates UI to highlight current resolution
    ↓
Shows specific codec variant if 1080p/1440p
```

## Storage Strategy

### Cache Storage

**Location**: `chrome.storage.session` (fallback to `chrome.storage.local`)

**Why session storage?**
- Faster (in-memory)
- No disk I/O
- Automatically cleared when browser closes
- Appropriate for temporary data like video sizes

**Cache Structure**:
```javascript
{
  "sizeCache_VIDEO_ID": {
    timestamp: 1638360000000,  // epoch ms
    human: {
      s144p: "8.64 MB",
      s240p: "17.28 MB",
      s360p: "34.56 MB",
      s480p: "69.12 MB",
      s720p: "144.00 MB",
      s1080p: "316.80 MB",
      s1440p: "518.40 MB",
      s1080p_299: "316.80 MB",  // H.264 variant
      s1080p_303: "237.60 MB",  // VP9 variant
      s1080p_399: "198.00 MB",  // AV1 variant
      duration: "5:32"
    },
    bytes: {
      s144p: 9062400,
      s240p: 18124800,
      // ... etc
    }
  }
}
```

**TTL Management**:
- Default: 24 hours
- Configurable: 1-48 hours in options
- Cleanup: On install and opportunistically

### Settings Storage

**Location**: `chrome.storage.local` (persistent)

**Structure**:
```javascript
{
  "ytSize_settings": {
    autoPrefetch: true,           // Auto-fetch on page load
    ttlHours: 24,                 // Cache TTL
    showBadge: true,              // Show badge indicators
    showLength: true,             // Show duration in popup
    useCloud: false,              // Use cloud API instead of native host
    cloudApiUrl: "",              // Cloud API endpoint
    resolutions: ["480p", "720p", "1080p", "1440p"]  // Which to show
  }
}
```

**Synchronization**: 
- Settings changes trigger `chrome.storage.onChanged` event
- All components listen and update their local settings copy
- Changes take effect immediately without restart

## Error Handling

### Hierarchy of Fallbacks

1. **Primary Path Fails** → Try Alternative Path
   - Native host fails → Try cloud API
   - Cloud API fails → Try native host

2. **Both Fail + Cache Exists** → Show cached (with "stale" indicator)

3. **All Fail + Duration Known** → Show estimates (with "Est." prefix)

4. **Complete Failure** → Show error message with actionable guidance

### Error Messages

The extension provides context-specific error messages:

| Error Condition | Message | User Action |
|----------------|---------|-------------|
| Not on YouTube | "Please open a YouTube video page..." | Navigate to YouTube |
| Native host not found | "Failed to connect to native host..." | Install native host |
| yt-dlp timeout | "yt-dlp timed out..." | Check network, try again |
| No video ID | "Could not extract YouTube video ID..." | Check URL format |
| Cloud API not configured | "Cloud API URL not configured" | Configure in options |

### Badge States

| Badge | Meaning | Duration |
|-------|---------|----------|
| `.` `..` `...` | Fetching data (animated) | Until complete |
| `✓` | Data cached successfully | Persistent |
| `!` | Fetch failed | 8 seconds |
| (empty) | Not a YouTube page | Persistent |

## Performance Considerations

### Optimization Strategies

1. **Rate Limiting**
   - Max 1 fetch per video per 10 seconds
   - Prevents duplicate requests during rapid navigation

2. **Duration Hints**
   - Content script reports duration from video element
   - Avoids redundant yt-dlp duration calls
   - 1-hour TTL for hints

3. **Caching**
   - Session storage for speed
   - 24-hour default TTL balances freshness vs. API load
   - Dual-write to local storage ensures popup reliability

4. **Lazy Loading**
   - Popup only fetches data for current video
   - Background only prefetches on navigation/activation
   - Respects `autoPrefetch` setting

5. **Debouncing**
   - Content script debounces identical metadata
   - Prevents message spam during playback

### Resource Usage

**Memory**:
- Cache: ~2KB per video (10 resolutions × ~200 bytes)
- 100 videos cached = ~200KB
- Duration hints: ~100 bytes per video

**Network**:
- Native host: No network (local subprocess)
- Cloud API: ~1-3 seconds per request, ~50KB response

**CPU**:
- Background: Minimal (event-driven)
- Popup: Minimal (simple rendering)
- Native host: Delegates to yt-dlp (can be CPU-intensive)

### Scaling Considerations

**Single User**:
- Works efficiently up to 1000+ cached videos
- No performance degradation

**Cloud API Multi-User**:
- Needs rate limiting per IP/API key
- Consider Redis cache for popular videos
- Load balancer for multiple instances
- CDN for static assets

## Future Enhancements

### Potential Improvements

1. **Security**
   - Fix command injection in cloud API
   - Add API authentication
   - Implement CSRF protection

2. **Features**
   - Persistent notification when prefetch completes
   - Batch download button integration
   - Video quality recommendations based on size

3. **Performance**
   - Shared cache between tabs
   - Background prefetch for related videos
   - WebAssembly yt-dlp for in-browser execution

4. **Testing**
   - Unit tests for all utility functions
   - Integration tests for message passing
   - E2E tests for user workflows

5. **Monitoring**
   - Telemetry for error rates
   - Analytics for feature usage
   - Performance metrics tracking

---

**Last Updated**: February 2, 2026
**Version**: 0.2.0

# API Reference - YouTube Size Extension

This document provides detailed API documentation for all public functions and message protocols used in the YouTube Size extension.

## Table of Contents

1. [Background Service Worker API](#background-service-worker-api)
2. [Content Script API](#content-script-api)
3. [Native Messaging Protocol](#native-messaging-protocol)
4. [Cloud API Specification](#cloud-api-specification)
5. [Storage Schema](#storage-schema)
6. [Message Passing Protocol](#message-passing-protocol)

---

## Background Service Worker API

### Core Functions

#### `prefetchForUrl(url, tabId, forced)`

Main orchestration function for fetching video size data.

**Parameters:**

- `url` (string): The YouTube video URL to fetch data for
- `tabId` (number, optional): The tab ID for badge updates
- `forced` (boolean, default: false): If true, bypasses autoPrefetch setting and rate limits

**Returns:** `Promise<void>`

**Behavior:**

- Validates URL is a YouTube video
- Checks cache freshness (respects TTL)
- Rate limits to 1 request per 10 seconds per video
- Tries native host first, falls back to cloud API
- Updates cache and notifies open popups
- Shows badge animations during fetch

**Example:**

```javascript
await prefetchForUrl("https://youtube.com/watch?v=dQw4w9WgXcQ", 123, true);
```

---

#### `callNativeHost(url, durationHint)`

Communicates with the Python native messaging host.

**Parameters:**

- `url` (string): YouTube video URL
- `durationHint` (number, optional): Video duration in seconds

**Returns:** `Promise<Object>`

**Response Object:**

```javascript
{
  ok: true,
  bytes: {
    s144p: 9062400,
    s240p: 18124800,
    s360p: 36249600,
    s480p: 72499200,
    s720p: 144998400,
    s1080p: 316796160,
    s1440p: 518400000,
    s1080p_299: 316796160,  // H.264
    s1080p_303: 237597120,  // VP9
    s1080p_399: 198397920,  // AV1
    s1440p_308: 518400000,  // VP9
    s1440p_400: 432000000,  // AV1
    a251: 3600000           // Audio only
  },
  human: {
    s144p: "8.64 MB",
    s240p: "17.28 MB",
    // ... etc
    duration: "5:32"
  },
  duration: 332  // seconds
}
```

**Error Handling:**

- Rejects with descriptive error message
- Common errors:
    - "Failed to connect to native host"
    - "yt-dlp not found in PATH"
    - "yt-dlp timed out"

---

#### `callCloudApi(url, durationHint)`

Calls the cloud API for size data.

**Parameters:**

- `url` (string): YouTube video URL
- `durationHint` (number, optional): Video duration in seconds

**Returns:** `Promise<Object>` (same structure as `callNativeHost`)

**Requirements:**

- `settings.cloudApiUrl` must be configured
- API endpoint must be accessible
- Timeout: 25 seconds

---

#### `isFreshInCache(videoId)`

Checks if cached data is still valid.

**Parameters:**

- `videoId` (string): 11-character YouTube video ID

**Returns:** `Promise<boolean>`

**Validation Criteria:**

- Cache entry exists
- Has valid timestamp
- Age is within TTL (default 24 hours)
- Contains at least one size value

---

### Utility Functions

#### `isYouTubeUrl(url)`

**Parameters:**

- `url` (string): URL to validate

**Returns:** `boolean`

**Supported URL Formats:**

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID`

---

#### `extractVideoId(url)`

**Parameters:**

- `url` (string): YouTube URL

**Returns:** `string | null`

**Returns:** 11-character video ID or null if not found

**Example:**

```javascript
extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ"); // 'dQw4w9WgXcQ'
extractVideoId("https://youtu.be/dQw4w9WgXcQ"); // 'dQw4w9WgXcQ'
extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ"); // 'dQw4w9WgXcQ'
```

---

#### `humanizeBytesDecimal(n)`

Converts bytes to human-readable format using SI units.

**Parameters:**

- `n` (number): Number of bytes

**Returns:** `string | null`

**Examples:**

```javascript
humanizeBytesDecimal(1000); // "1.00 KB"
humanizeBytesDecimal(1500000); // "1.50 MB"
humanizeBytesDecimal(2500000000); // "2.50 GB"
```

---

## Content Script API

The content script runs on all YouTube pages and exposes no public API, but sends messages to the background worker.

### Outgoing Messages

#### `yt_current_res` Message

Sent when video resolution or metadata changes.

**Message Structure:**

```javascript
{
  type: 'yt_current_res',
  url: 'https://youtube.com/watch?v=...',
  videoId: 'dQw4w9WgXcQ',
  height: 1080,              // Video height in pixels
  label: '1080p',            // Mapped resolution label
  itag: '399',               // Format ID (codec identifier)
  durationSec: 332           // Optional: video duration
}
```

**When Sent:**

- Video metadata loads (`loadedmetadata` event)
- Video quality changes
- User seeks or plays video
- SPA navigation to new video

---

### Incoming Messages

#### `get_current_res` Request

The popup can request current video state from the content script.

**Request:**

```javascript
{
    type: "get_current_res";
}
```

**Response:**

```javascript
{
  ok: true,
  url: 'https://youtube.com/watch?v=...',
  videoId: 'dQw4w9WgXcQ',
  height: 1080,
  label: '1080p',
  itag: '399',
  durationSec: 332
}
```

---

## Native Messaging Protocol

### Protocol Specification

The native messaging host uses Chrome's native messaging protocol:

**Message Format:**

1. First 4 bytes: Message length (uint32, little-endian)
2. Remaining bytes: UTF-8 encoded JSON

**Communication:**

- Input: stdin (extension → host)
- Output: stdout (host → extension)
- Logging: stderr (for debugging)

---

### Request Message

```json
{
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "duration_hint": 332
}
```

**Fields:**

- `url` (required): YouTube video URL
- `duration_hint` (optional): Duration in seconds to avoid extra yt-dlp call

---

### Response Message

**Success Response:**

```json
{
    "ok": true,
    "bytes": {
        "s144p": 9062400,
        "s240p": 18124800,
        "s360p": 36249600,
        "s480p": 72499200,
        "s720p": 144998400,
        "s1080p": 316796160,
        "s1440p": 518400000,
        "s1080p_299": 316796160,
        "s1080p_303": 237597120,
        "s1080p_399": 198397920,
        "s1440p_308": 518400000,
        "s1440p_400": 432000000,
        "v394": 8662400,
        "v395": 17724800,
        "v396": 35649600,
        "v397": 71899200,
        "v398": 143398400,
        "v399": 315196160,
        "v400": 514800000,
        "v299": 315196160,
        "v303": 235997120,
        "v308": 514800000,
        "a251": 3600000
    },
    "human": {
        "s144p": "8.64 MB",
        "s240p": "17.28 MB",
        "s360p": "34.56 MB",
        "s480p": "69.12 MB",
        "s720p": "138.24 MB",
        "s1080p": "302.08 MB",
        "s1440p": "494.38 MB",
        "s1080p_299": "302.08 MB",
        "s1080p_303": "226.56 MB",
        "s1080p_399": "189.13 MB",
        "s1440p_308": "494.38 MB",
        "s1440p_400": "411.94 MB",
        "duration": "5:32"
    },
    "duration": 332
}
```

**Error Response:**

```json
{
    "ok": false,
    "error": "yt-dlp not found in PATH. Please install yt-dlp."
}
```

**Common Errors:**

- `"yt-dlp not found in PATH. Please install yt-dlp."`
- `"yt-dlp timed out while fetching data."`
- `"No size information could be determined from yt-dlp output."`
- `"No URL provided."`

---

### Format ID Reference

#### Video Formats

| Resolution | Primary Format ID | Codec   | Alternative IDs        |
| ---------- | ----------------- | ------- | ---------------------- |
| 144p       | 394               | AV1/VP9 | -                      |
| 240p       | 395               | AV1/VP9 | -                      |
| 360p       | 396               | AV1/VP9 | -                      |
| 480p       | 397               | AV1/VP9 | -                      |
| 720p       | 398               | AV1/VP9 | -                      |
| 1080p      | 399               | AV1     | 299 (H.264), 303 (VP9) |
| 1440p      | 400               | AV1     | 308 (VP9)              |

#### Audio Formats

| Format ID | Codec | Typical Bitrate |
| --------- | ----- | --------------- |
| 251       | Opus  | 160 kbps        |

---

## Cloud API Specification

### Endpoints

#### `GET /`

Health check endpoint.

**Response:**

```json
{
    "ok": true,
    "service": "ytdlp-sizer-api"
}
```

---

#### `POST /size`

Extract video size information.

**Request Body:**

```json
{
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "duration_hint": 332
}
```

**Success Response (200):**

```json
{
    "ok": true,
    "bytes": {
        /* same as native host */
    },
    "human": {
        /* same as native host */
    },
    "duration": 332
}
```

**Error Responses:**

**400 Bad Request:**

```json
{
    "ok": false,
    "error": "URL is required"
}
```

**502 Bad Gateway:**

```json
{
    "ok": false,
    "error": "Failed to fetch metadata: [yt-dlp error message]"
}
```

**504 Gateway Timeout:**

```json
{
    "ok": false,
    "error": "yt-dlp timed out while fetching metadata"
}
```

---

### CORS Configuration

The API enables CORS for all origins:

```javascript
app.use(cors());
```

**Production Recommendation:**

```javascript
app.use(
    cors({
        origin: ["chrome-extension://YOUR_EXTENSION_ID"],
        methods: ["POST"],
        credentials: true,
    }),
);
```

---

## Storage Schema

### Cache Storage (`chrome.storage.session` or `chrome.storage.local`)

**Key Pattern:** `sizeCache_{VIDEO_ID}`

**Value Structure:**

```typescript
interface CacheEntry {
    timestamp: number; // Epoch milliseconds
    human: {
        s144p: string | null;
        s240p: string | null;
        s360p: string | null;
        s480p: string | null;
        s720p: string | null;
        s1080p: string | null;
        s1440p: string | null;
        s1080p_299: string | null;
        s1080p_303: string | null;
        s1080p_399: string | null;
        s1440p_308: string | null;
        s1440p_400: string | null;
        duration: string | null;
    };
    bytes: {
        s144p: number | null;
        s240p: number | null;
        s360p: number | null;
        s480p: number | null;
        s720p: number | null;
        s1080p: number | null;
        s1440p: number | null;
        s1080p_299: number | null;
        s1080p_303: number | null;
        s1080p_399: number | null;
        s1440p_308: number | null;
        s1440p_400: number | null;
    };
}
```

---

### Settings Storage (`chrome.storage.local`)

**Key:** `ytSize_settings`

**Value Structure:**

```typescript
interface Settings {
    autoPrefetch: boolean; // Default: true
    ttlHours: number; // Range: 1-48, Default: 24
    showBadge: boolean; // Default: true
    showLength: boolean; // Default: true
    useCloud: boolean; // Default: false
    cloudApiUrl: string; // Default: ""
    resolutions: string[]; // Default: ["480p", "720p", "1080p", "1440p"]
}
```

**Valid Resolution Values:**

- `"144p"`
- `"240p"`
- `"360p"`
- `"480p"`
- `"720p"`
- `"1080p"`
- `"1440p"`

---

## Message Passing Protocol

### Background ← Popup Messages

#### Prefetch Request

```javascript
chrome.runtime.sendMessage(
    {
        type: "prefetch",
        url: "https://youtube.com/watch?v=...",
        forced: true,
        tabId: 123,
        durationSec: 332,
    },
    (response) => {
        // response: { ok: boolean, reason: string }
    },
);
```

**Reasons:**

- `"fresh"`: Cache already fresh
- `"in_flight"`: Already fetching
- `"rate_limited"`: Too soon since last fetch
- `"started"`: Fetch initiated

---

#### Ensure Badge Request

```javascript
chrome.runtime.sendMessage(
    {
        type: "ensureBadge",
        url: "https://youtube.com/watch?v=...",
        tabId: 123,
    },
    (response) => {
        // response: { ok: true }
    },
);
```

---

### Background → Popup Messages

#### Cache Updated Notification

```javascript
{
  type: 'sizeCacheUpdated',
  videoId: 'dQw4w9WgXcQ'
}
```

Sent when background worker successfully fetches and caches new size data.

---

#### Cache Failed Notification

```javascript
{
  type: 'sizeCacheFailed',
  videoId: 'dQw4w9WgXcQ',
  error: 'Error message'
}
```

---

### Background ← Content Script Messages

#### Current Resolution Update

```javascript
{
  type: 'yt_current_res',
  url: 'https://youtube.com/watch?v=...',
  videoId: 'dQw4w9WgXcQ',
  height: 1080,
  label: '1080p',
  itag: '399',
  durationSec: 332
}
```

---

### Popup → Content Script Messages

#### Get Current Resolution

```javascript
chrome.tabs.sendMessage(
    tabId,
    {
        type: "get_current_res",
    },
    (response) => {
        // response: { ok: true, height: 1080, label: '1080p', itag: '399', ... }
    },
);
```

---

## Error Codes

### Native Host Exit Codes

| Code | Meaning                                |
| ---- | -------------------------------------- |
| 0    | Success                                |
| 1    | Generic error                          |
| 124  | Timeout                                |
| 127  | Command not found (yt-dlp not in PATH) |

### HTTP Status Codes (Cloud API)

| Code | Meaning                          |
| ---- | -------------------------------- |
| 200  | Success                          |
| 400  | Bad request (missing URL)        |
| 500  | Internal server error            |
| 502  | Bad gateway (yt-dlp error)       |
| 504  | Gateway timeout (yt-dlp timeout) |

---

**Last Updated**: February 2, 2026
**API Version**: 0.2.0

# API Versioning Guide

## Current Version: v1

The YouTube Size API follows semantic versioning and includes version information in the URL path for major API changes.

## Versioning Strategy

### URL-Based Versioning

All API endpoints are versioned using URL path prefixes:

```
/api/v1/size    - Version 1 size endpoint
/api/v2/size    - Version 2 (future)
```

### Backward Compatibility

- **Legacy Endpoint**: `/size` (deprecated but maintained for backward compatibility)
- **Current Endpoint**: `/api/v1/size` (recommended)
- **Future Versions**: `/api/v2/size`, etc.

## Version 1 (v1) - Current

### Endpoints

#### POST /api/v1/size

Extract YouTube video size information.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=VIDEO_ID",
  "duration_hint": 180
}
```

**Response:**
```json
{
  "ok": true,
  "bytes": {
    "s144p": 12345678,
    "s240p": 23456789,
    "s360p": 34567890,
    "s480p": 45678901,
    "s720p": 67890123,
    "s1080p": 123456789,
    "s1440p": null,
    "s1080p_299": 120000000,
    "s1080p_303": 125000000,
    "s1080p_399": 123456789,
    "s1440p_308": null,
    "s1440p_400": null
  },
  "human": {
    "s144p": "11.77 MB",
    "s240p": "22.38 MB",
    "s360p": "32.97 MB",
    "s480p": "43.56 MB",
    "s720p": "64.75 MB",
    "s1080p": "117.74 MB",
    "s1440p": null,
    "s1080p_299": "114.44 MB",
    "s1080p_303": "119.21 MB",
    "s1080p_399": "117.74 MB",
    "s1440p_308": null,
    "s1440p_400": null,
    "duration": "3:00"
  },
  "duration": 180
}
```

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: your-api-key` (if authentication is enabled)

**Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid URL or parameters
- `401 Unauthorized` - Missing or invalid API key
- `429 Too Many Requests` - Rate limit exceeded
- `502 Bad Gateway` - yt-dlp execution failed
- `504 Gateway Timeout` - yt-dlp execution timed out

## Migration Guide

### From Legacy Endpoint to v1

**Before (Deprecated):**
```javascript
fetch('https://api.example.com/size', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: videoUrl })
})
```

**After (Recommended):**
```javascript
fetch('https://api.example.com/api/v1/size', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'your-api-key'  // If auth is enabled
    },
    body: JSON.stringify({ url: videoUrl })
})
```

### Changes from Legacy to v1

1. **URL Path**: Changed from `/size` to `/api/v1/size`
2. **Authentication**: API key authentication added (optional but recommended)
3. **Response Format**: Identical to legacy endpoint
4. **Rate Limiting**: Applied consistently across versioned endpoints

## Health & Monitoring Endpoints

### GET /

Root endpoint with basic service information.

**Response:**
```json
{
  "ok": true,
  "service": "ytdlp-sizer-api",
  "version": "v1",
  "status": "running",
  "documentation": "/api/v1/docs"
}
```

### GET /health

Basic health check for load balancers and monitoring.

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2026-02-02T12:34:56.789Z"
}
```

### GET /health/detailed

Comprehensive health metrics (can be disabled in production).

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2026-02-02T12:34:56.789Z",
  "version": "v1",
  "uptime": {
    "seconds": 3600,
    "formatted": "1h"
  },
  "system": {
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "v18.17.0",
    "cpus": 4,
    "memory": {
      "total": 8589934592,
      "free": 4294967296,
      "used": 4294967296,
      "usagePercent": "50.00"
    },
    "loadAverage": [1.2, 1.5, 1.8]
  },
  "dependencies": {
    "ytdlp": {
      "available": true,
      "version": "2024.01.01"
    }
  }
}
```

### GET /health/metrics

Request and performance statistics.

**Response:**
```json
{
  "ok": true,
  "timestamp": "2026-02-02T12:34:56.789Z",
  "uptime": {
    "seconds": 3600,
    "formatted": "1h"
  },
  "requests": {
    "total": 1500,
    "success": 1450,
    "failed": 50,
    "successRate": "96.67%",
    "byEndpoint": {
      "POST /api/v1/size": 1400,
      "GET /health": 100
    }
  },
  "errors": {
    "validation": 20,
    "ytdlp": 15,
    "timeout": 10,
    "auth": 3,
    "rateLimit": 2
  },
  "performance": {
    "avgResponseTime": "1250ms",
    "minResponseTime": "500ms",
    "maxResponseTime": "24500ms"
  }
}
```

### GET /health/ready

Kubernetes readiness probe - checks if service can accept traffic.

**Response:**
```json
{
  "ok": true,
  "ready": true
}
```

### GET /health/live

Kubernetes liveness probe - checks if service is alive.

**Response:**
```json
{
  "ok": true,
  "alive": true
}
```

### GET /api/v1/docs

API documentation endpoint.

**Response:**
```json
{
  "version": "v1",
  "service": "ytdlp-sizer-api",
  "description": "API for extracting YouTube video size information",
  "endpoints": {
    "health": {
      "GET /": "Root endpoint with basic info",
      "GET /health": "Basic health check",
      "GET /health/detailed": "Detailed health metrics",
      "GET /health/metrics": "Request and performance metrics",
      "GET /health/ready": "Readiness probe",
      "GET /health/live": "Liveness probe"
    },
    "api": {
      "POST /api/v1/size": "Extract video size information"
    }
  },
  "authentication": "Required: X-API-Key header",
  "rateLimit": "20 requests per 60 seconds"
}
```

## Future Versions

### Planned for v2

- WebSocket support for real-time updates
- Batch processing for multiple URLs
- Caching layer with Redis
- Advanced format selection options
- Video quality recommendations based on network speed

## Deprecation Policy

1. **Notice Period**: 6 months minimum before removing deprecated endpoints
2. **Warnings**: Deprecated endpoints return a `warning` field in responses
3. **Documentation**: Deprecated endpoints marked clearly in documentation
4. **Support**: Security fixes only for deprecated versions

## Version History

| Version | Release Date | Status | End of Life |
|---------|--------------|--------|-------------|
| v1 | 2026-02-02 | Current | N/A |
| Legacy (/size) | 2025-01-01 | Deprecated | 2026-08-02 |

---

**Last Updated:** February 2, 2026

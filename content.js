(function() {
  // Detect current playing resolution on YouTube and send updates
  let lastLabel = null;
  let lastHeight = null;
  let lastVideoId = null;
  let lastItag = null;

  function isYouTubeUrl(url) {
    try {
      const u = new URL(url);
      return (
        u.host.includes('youtube.com') || u.host.includes('youtu.be')
      ) && (
        u.searchParams.has('v') || u.pathname.startsWith('/watch') || /\/shorts\//.test(u.pathname) || u.host.includes('youtu.be')
      );
    } catch (_) { return false; }
  }

  function extractCurrentItag() {
    try {
      const v = getVideoEl();
      if (!v) return null;
      const src = v.currentSrc || '';
      if (!src) return null;
      const u = new URL(src);
      const it = u.searchParams.get('itag');
      return it || null;
    } catch (_) {
      return null;
    }
  }

  function extractVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtu.be')) {
        const id = u.pathname.replace(/^\//, '').split('/')[0];
        return id || null;
      }
      if (u.searchParams.has('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/shorts\/([\w-]{5,})/);
      if (m) return m[1];
      return null;
    } catch (_) { return null; }
  }

  function mapHeightToLabel(h) {
    if (!h || !isFinite(h)) return null;
    const ladder = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    // Use exact match or nearest below
    let best = ladder[0];
    for (const v of ladder) {
      if (h >= v) best = v;
    }
    return best + 'p';
  }

  function getVideoEl() {
    // Prefer YouTube's main video element
    const main = document.querySelector('ytd-player video.html5-main-video');
    if (main) return main;
    // Fallback: first playing video element
    const vids = document.querySelectorAll('video');
    for (const v of vids) {
      if (!v) continue;
      if (!v.src && v.querySelector('source') == null) continue;
      return v;
    }
    return null;
  }

  function readAndNotify(force=false) {
    if (!isYouTubeUrl(location.href)) return;
    const vid = getVideoEl();
    const vh = vid ? (vid.videoHeight || 0) : 0;
    const label = mapHeightToLabel(vh);
    const itag = extractCurrentItag();
    const videoId = extractVideoId(location.href);
    const dur = vid ? Math.round((Number.isFinite(vid.duration) ? vid.duration : 0)) : 0;
    // Debounce identical values
    if (!force && lastLabel === label && lastHeight === vh && lastVideoId === videoId && lastItag === itag) return;
    lastLabel = label;
    lastHeight = vh;
    lastVideoId = videoId;
    lastItag = itag;
    try {
      chrome.runtime.sendMessage({
        type: 'yt_current_res',
        url: location.href,
        height: vh,
        label,
        videoId,
        itag,
        durationSec: (dur && dur > 0 ? dur : undefined)
      }, () => {
        // ignore lastError
        const _e = chrome && chrome.runtime && chrome.runtime.lastError; void _e;
      });
    } catch (_) {}
  }

  // Track URL changes without injecting inline scripts (CSP-safe)
  let lastHref = location.href;
  let urlPollId = null;
  function startUrlPoller(intervalMs = 1500) {
    try { if (urlPollId) clearInterval(urlPollId); } catch (_) {}
    urlPollId = setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        setTimeout(() => readAndNotify(true), 300);
      }
    }, intervalMs);
  }

  function listenForSpaNavigations() {
    const onChange = (href) => {
      const h = href || location.href;
      if (h !== lastHref) {
        lastHref = h;
        setTimeout(() => readAndNotify(true), 300);
      }
    };
    // YouTube-specific SPA events
    window.addEventListener('yt-navigate-finish', () => onChange(location.href), true);
    window.addEventListener('yt-page-data-updated', () => onChange(location.href), true);
    // Fallbacks
    window.addEventListener('popstate', () => onChange(location.href), true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onChange(location.href); }, true);
  }

  function setup() {
    readAndNotify(true);
    const v = getVideoEl();
    if (!v) return;
    v.addEventListener('loadedmetadata', () => readAndNotify(true));
    v.addEventListener('loadeddata', () => readAndNotify());
    v.addEventListener('resize', () => readAndNotify());
    // Some players change quality on play/seek
    v.addEventListener('play', () => setTimeout(readAndNotify, 300));
    v.addEventListener('seeked', () => setTimeout(readAndNotify, 300));
  }

  // Listen for popup requests
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === 'get_current_res') {
        const v = getVideoEl();
        const vh = v ? (v.videoHeight || 0) : 0;
        const label = mapHeightToLabel(vh);
        const itag = extractCurrentItag();
        const videoId = extractVideoId(location.href);
        const dur = v ? Math.round((Number.isFinite(v.duration) ? v.duration : 0)) : 0;
        try { sendResponse({ ok: true, height: vh, label, url: location.href, videoId, itag, durationSec: (dur && dur > 0 ? dur : undefined) }); } catch (_) {}
        return true;
      }
    });
  } catch (_) {}

  // Hook into SPA navigations with minimal overhead (no inline scripts)
  listenForSpaNavigations();
  startUrlPoller(3000);

  // Kick off
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setup();
  } else {
    window.addEventListener('DOMContentLoaded', setup);
  }
})();

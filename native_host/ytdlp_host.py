#!/usr/bin/env python3
import sys
import struct
import json
import subprocess
import re
from typing import Optional, List, Dict, Any

# Simple debug logger (stderr so it won't interfere with native messaging stdout)
def _dbg(msg: str):
    try:
        sys.stderr.write(f"[host] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass

# Native messaging protocol helpers

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return None
    if len(raw_length) < 4:
        return None
    message_length = struct.unpack('<I', raw_length)[0]
    if message_length == 0:
        return None
    data = sys.stdin.buffer.read(message_length)
    if len(data) < message_length:
        return None
    try:
        return json.loads(data.decode('utf-8'))
    except Exception:
        return None


def send_message(msg: dict):
    try:
        encoded = json.dumps(msg).encode('utf-8')
    except Exception as e:
        # last resort
        encoded = json.dumps({"ok": False, "error": f"Failed to encode response: {e}"}).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def humanize_bytes(n: int) -> str:
    if n is None:
        return 'N/A'
    # Use decimal (SI) units as requested: KB, MB, GB, TB
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    v = float(n)
    i = 0
    while v >= 1000.0 and i < len(units) - 1:
        v /= 1000.0
        i += 1
    if i == 0:
        return f"{int(v)} {units[i]}"
    return f"{v:.2f} {units[i]}"


def humanize_duration(seconds) -> str:
    if seconds is None:
        return None
    try:
        s = int(round(float(seconds)))
    except Exception:
        return None
    h = s // 3600
    m = (s % 3600) // 60
    sec = s % 60
    if h > 0:
        return f"{h:d}:{m:02d}:{sec:02d}"
    return f"{m:d}:{sec:02d}"

SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB)")
ID_RE = re.compile(r"^\s*(\d{3,4})\b")


def parse_sizes_from_format_list(text: str):
    sizes = {"394": None, "395": None, "396": None, "397": None, "398": None, "399": None, "400": None,
             "299": None, "303": None, "308": None, "251": None}
    for line in text.splitlines():
        m_id = ID_RE.match(line)
        if not m_id:
            continue
        fid = m_id.group(1)
        if fid not in sizes:
            continue
        m_sz = SIZE_RE.search(line)
        if not m_sz:
            continue
        num = float(m_sz.group(1))
        unit = m_sz.group(2)
        factor = {
            'KiB': 1024,
            'MiB': 1024**2,
            'GiB': 1024**3,
            'TiB': 1024**4,
        }[unit]
        sizes[fid] = int(num * factor)
    return sizes


def run_ytdlp_dump_json(url: str, timeout_sec: int = 25):
    """Return (json_obj:dict|None, err:str|None, code:int) using -J --no-playlist to avoid multiple calls"""
    try:
        proc = subprocess.run(
            ["yt-dlp", "-J", "-s", "--no-playlist", url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_sec,
        )
    except FileNotFoundError:
        return None, "yt-dlp not found in PATH. Please install yt-dlp.", 127
    except subprocess.TimeoutExpired:
        return None, "yt-dlp timed out while fetching metadata.", 124
    out = proc.stdout or ""
    err = proc.stderr or ""
    if proc.returncode != 0:
        return None, err.strip() or f"yt-dlp exited with code {proc.returncode}", proc.returncode
    try:
        obj = json.loads(out)
    except Exception as e:
        return None, f"Failed to parse yt-dlp JSON: {e}", 1
    return obj, None, 0


def _get_num(val):
    try:
        if val is None:
            return None
        v = float(val)
        return v
    except Exception:
        return None


def _filesize_from_fmt(fmt: dict, duration_sec: Optional[int]):
    # Prefer exact filesize, then approx; else estimate from tbr/vbr/abr and duration
    for k in ("filesize", "filesize_approx"):
        v = fmt.get(k)
        if isinstance(v, (int, float)):
            try:
                return int(v)
            except Exception:
                pass
    kbps = None
    for k in ("tbr", "vbr", "abr"):
        v = _get_num(fmt.get(k))
        if v is not None and v > 0:
            kbps = v
            break
    if duration_sec and kbps:
        try:
            # kbps -> bytes/sec = (kbps*1000)/8
            return int((kbps * 1000.0 / 8.0) * float(duration_sec))
        except Exception:
            return None
    return None


def _pick_audio(formats: List[Dict[str, Any]], duration_sec: Optional[int]):
    cands = []
    for f in formats or []:
        acodec = (f.get('acodec') or '').lower()
        vcodec = (f.get('vcodec') or '').lower()
        if vcodec == 'none' and acodec != 'none':
            cands.append(f)
    if not cands:
        return None, None
    def score(f):
        ac = (f.get('acodec') or '').lower()
        ext = (f.get('ext') or '').lower()
        s = 0
        if 'opus' in ac: s += 3
        if ext == 'webm': s += 1
        if 'aac' in ac or ext == 'm4a': s += 2
        if _filesize_from_fmt(f, duration_sec) is not None: s += 2
        return s, _get_num(f.get('abr')) or 0.0
    best = max(cands, key=score)
    return best, _filesize_from_fmt(best, duration_sec)


def _pick_video_by_height(formats: List[Dict[str, Any]], target_h: int, duration_sec: Optional[int]):
    """Prefer exact height; else nearest below; else nearest above. Return (fmt, size_bytes)."""
    videos = []
    for f in formats or []:
        vcodec = (f.get('vcodec') or '').lower()
        acodec = (f.get('acodec') or '').lower()
        if vcodec != 'none' and acodec == 'none':
            h = f.get('height')
            if isinstance(h, int) and h > 0:
                videos.append(f)
    if not videos:
        return None, None
    exact = [f for f in videos if f.get('height') == target_h]
    if exact:
        # among exact, prefer one with known filesize; else higher tbr
        def key1(f):
            size = _filesize_from_fmt(f, duration_sec)
            has = 1 if size is not None else 0
            tbr = _get_num(f.get('tbr')) or 0.0
            return (has, tbr, f.get('fps') or 0)
        best = sorted(exact, key=key1, reverse=True)[0]
        return best, _filesize_from_fmt(best, duration_sec)
    below = [f for f in videos if isinstance(f.get('height'), int) and f.get('height') < target_h]
    if below:
        # choose the maximum height below target
        mh = max(f.get('height') for f in below)
        cands = [f for f in below if f.get('height') == mh]
        def key2(f):
            size = _filesize_from_fmt(f, duration_sec)
            has = 1 if size is not None else 0
            tbr = _get_num(f.get('tbr')) or 0.0
            return (has, tbr, f.get('fps') or 0)
        best = sorted(cands, key=key2, reverse=True)[0]
        return best, _filesize_from_fmt(best, duration_sec)
    above = [f for f in videos if isinstance(f.get('height'), int) and f.get('height') > target_h]
    if above:
        mh = min(f.get('height') for f in above)
        cands = [f for f in above if f.get('height') == mh]
        def key3(f):
            size = _filesize_from_fmt(f, duration_sec)
            has = 1 if size is not None else 0
            tbr = _get_num(f.get('tbr')) or 0.0
            return (has, tbr, f.get('fps') or 0)
        best = sorted(cands, key=key3, reverse=True)[0]
        return best, _filesize_from_fmt(best, duration_sec)
    return None, None


def _pick_progressive_by_height(formats: List[Dict[str, Any]], target_h: int, duration_sec: Optional[int]):
    progs = []
    for f in formats or []:
        vcodec = (f.get('vcodec') or '').lower()
        acodec = (f.get('acodec') or '').lower()
        if vcodec != 'none' and acodec != 'none':
            h = f.get('height')
            if isinstance(h, int) and h > 0:
                progs.append(f)
    if not progs:
        return None, None
    exact = [f for f in progs if f.get('height') == target_h]
    if exact:
        def keyp1(f):
            size = _filesize_from_fmt(f, duration_sec)
            has = 1 if size is not None else 0
            tbr = _get_num(f.get('tbr')) or 0.0
            return (has, tbr, f.get('fps') or 0)
        best = sorted(exact, key=keyp1, reverse=True)[0]
        return best, _filesize_from_fmt(best, duration_sec)
    below = [f for f in progs if isinstance(f.get('height'), int) and f.get('height') < target_h]
    if below:
        mh = max(f.get('height') for f in below)
        cands = [f for f in below if f.get('height') == mh]
        def keyp2(f):
            size = _filesize_from_fmt(f, duration_sec)
            has = 1 if size is not None else 0
            tbr = _get_num(f.get('tbr')) or 0.0
            return (has, tbr, f.get('fps') or 0)
        best = sorted(cands, key=keyp2, reverse=True)[0]
        return best, _filesize_from_fmt(best, duration_sec)
    above = [f for f in progs if isinstance(f.get('height'), int) and f.get('height') > target_h]
    if above:
        mh = min(f.get('height') for f in above)
        cands = [f for f in above if f.get('height') == mh]
        def keyp3(f):
            size = _filesize_from_fmt(f, duration_sec)
            has = 1 if size is not None else 0
            tbr = _get_num(f.get('tbr')) or 0.0
            return (has, tbr, f.get('fps') or 0)
        best = sorted(cands, key=keyp3, reverse=True)[0]
        return best, _filesize_from_fmt(best, duration_sec)
    return None, None


def compute_sizes_from_json_all(meta: dict, duration_hint: Optional[int] = None):
    """Compute sizes for 144p, 240p, 360p, 480p, 720p, 1080p plus duration from yt-dlp JSON.
    Prefer separate video-only by target height + best audio; otherwise fall back to progressive.
    Returns (sizes_by_height: dict, video_only_by_id: dict, audio_251_bytes: int|None, duration_sec: int|None).
    """
    if not isinstance(meta, dict):
        return {}, {}, None, None
    # Handle playlist structures: pick first entry with formats
    try:
        if 'entries' in meta and isinstance(meta['entries'], list) and meta['entries']:
            for e in meta['entries']:
                if isinstance(e, dict) and e.get('formats'):
                    meta = e
                    break
            else:
                if isinstance(meta['entries'][0], dict):
                    meta = meta['entries'][0]
    except Exception:
        pass

    duration_sec = None
    try:
        d = meta.get('duration')
        if d is not None:
            duration_sec = int(float(d))
    except Exception:
        duration_sec = None
    # If the JSON didn't include duration, use a provided hint
    if duration_sec is None and isinstance(duration_hint, int) and duration_hint > 0:
        _dbg(f"using duration_hint in JSON compute: {duration_hint}")
        duration_sec = duration_hint

    def fmt_by_id(fid: str):
        for f in (meta.get('formats') or []):
            if str(f.get('format_id')) == fid:
                return f
        return None

    def size_for(f):
        if not f:
            return None
        s = f.get('filesize')
        if isinstance(s, (int, float)) and s > 0:
            return int(s)
        s = f.get('filesize_approx')
        if isinstance(s, (int, float)) and s > 0:
            return int(s)
        return None

    formats = meta.get('formats') or []
    # Audio: prefer explicit 251 size; else pick best audio
    a251_b = size_for(fmt_by_id('251'))
    if a251_b is None:
        _afmt, audio_fb = _pick_audio(formats, duration_sec)
    else:
        audio_fb = None
    audio_b = a251_b if a251_b is not None else audio_fb

    heights = [(144, '394'), (240, '395'), (360, '396'), (480, '397'), (720, '398'), (1080, '399'), (1440, '400')]
    sizes = { 's144': None, 's240': None, 's360': None, 's480': None, 's720': None, 's1080': None, 's1440': None }
    video_only = { 'v394': None, 'v395': None, 'v396': None, 'v397': None, 'v398': None, 'v399': None, 'v400': None,
                   'v299': None, 'v303': None, 'v308': None }

    for h, fid in heights:
        # exact id size if present
        v_exact_b = size_for(fmt_by_id(fid))
        # pick by height otherwise
        if v_exact_b is None:
            _vf, v_b = _pick_video_by_height(formats, h, duration_sec)
        else:
            v_b = v_exact_b
        # record video-only as best known for that height/id
        video_only_key = f"v{fid}"
        video_only[video_only_key] = v_b

        # Combine with audio if possible
        s_key = f"s{h}"
        if v_b is not None and audio_b is not None:
            sizes[s_key] = int(v_b + audio_b)
        else:
            # Progressive fallback
            _pf, p_b = _pick_progressive_by_height(formats, h, duration_sec)
            if p_b is not None:
                sizes[s_key] = int(p_b)

    # Also capture explicit 1080p/1440p variant itags if available (video-only bytes)
    f299 = fmt_by_id('299')
    f303 = fmt_by_id('303')
    f308 = fmt_by_id('308')
    video_only['v299'] = _filesize_from_fmt(f299, duration_sec) if f299 else None
    video_only['v303'] = _filesize_from_fmt(f303, duration_sec) if f303 else None
    video_only['v308'] = _filesize_from_fmt(f308, duration_sec) if f308 else None

    return sizes, video_only, a251_b, duration_sec


def run_ytdlp_list_formats(url: str, timeout_sec: int = 25):
    try:
        proc = subprocess.run(
            ["yt-dlp", "-F", "--no-playlist", url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_sec,
        )
    except FileNotFoundError:
        return None, "yt-dlp not found in PATH. Please install yt-dlp.", 127
    except subprocess.TimeoutExpired:
        return None, "yt-dlp timed out while listing formats.", 124
    out = proc.stdout or ""
    err = proc.stderr or ""
    if proc.returncode != 0:
        return out, err.strip() or f"yt-dlp exited with code {proc.returncode}", proc.returncode
    return out, None, 0


def run_ytdlp_get_duration(url: str, timeout_sec: int = 20):
    """Return (duration_seconds:int|None, err:str|None, code:int)"""
    # Use --print to directly output the duration in seconds if available
    try:
        proc = subprocess.run(
            ["yt-dlp", "--print", "%(duration)s", "-s", "--no-playlist", url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_sec,
        )
    except FileNotFoundError:
        return None, "yt-dlp not found in PATH. Please install yt-dlp.", 127
    except subprocess.TimeoutExpired:
        return None, "yt-dlp timed out while fetching duration.", 124
    out = (proc.stdout or "").strip()
    if proc.returncode != 0:
        return None, (proc.stderr or "").strip() or f"yt-dlp exited with code {proc.returncode}", proc.returncode
    # Sometimes duration may be empty/NA
    try:
        if out:
            val = int(float(out))
        else:
            val = None
    except Exception:
        val = None
    return val, None, 0


def main():
    _dbg("start")
    req = read_message()
    if req is None:
        _dbg("no request received; exiting")
        return
    url = req.get('url') if isinstance(req, dict) else None
    duration_hint = None
    try:
        dh = req.get('duration_hint') if isinstance(req, dict) else None
        if dh is not None:
            duration_hint = int(float(dh))
            if duration_hint <= 0:
                duration_hint = None
    except Exception:
        duration_hint = None
    if duration_hint is not None:
        _dbg(f"duration_hint received: {duration_hint}")
    if not url:
        _dbg("request missing 'url'")
        send_message({"ok": False, "error": "No URL provided."})
        return

    # Prefer a single JSON call to get sizes and duration; fall back to -F only if needed
    _dbg("running yt-dlp -J ...")
    meta, j_err, j_code = run_ytdlp_dump_json(url)
    s144 = s240 = s360 = s480 = s720 = s1080 = s1440 = None
    v144 = v240 = v360 = v480 = v720 = v1080 = v1440 = None
    v1080_299 = v1080_303 = v1080_399 = None
    v1440_308 = v1440_400 = None
    s1080_299 = s1080_303 = s1080_399 = None
    s1440_308 = s1440_400 = None
    a251 = None
    dur_sec = None

    if j_code == 0 and meta:
        sizes_by_h, video_only_by_id, a251_b, dur_sec = compute_sizes_from_json_all(meta, duration_hint)
        s144 = sizes_by_h.get('s144')
        s240 = sizes_by_h.get('s240')
        s360 = sizes_by_h.get('s360')
        s480 = sizes_by_h.get('s480')
        s720 = sizes_by_h.get('s720')
        s1080 = sizes_by_h.get('s1080')
        s1440 = sizes_by_h.get('s1440')
        v144 = video_only_by_id.get('v394')
        v240 = video_only_by_id.get('v395')
        v360 = video_only_by_id.get('v396')
        v480 = video_only_by_id.get('v397')
        v720 = video_only_by_id.get('v398')
        v1080 = video_only_by_id.get('v399')
        v1440 = video_only_by_id.get('v400')
        v1080_299 = video_only_by_id.get('v299')
        v1080_303 = video_only_by_id.get('v303')
        v1080_399 = video_only_by_id.get('v399')
        v1440_308 = video_only_by_id.get('v308')
        v1440_400 = video_only_by_id.get('v400')
        a251 = a251_b
        # Combine with 251 audio if available
        if a251 is not None:
            s1080_299 = (v1080_299 + a251) if v1080_299 is not None else None
            s1080_303 = (v1080_303 + a251) if v1080_303 is not None else None
            s1080_399 = (v1080_399 + a251) if v1080_399 is not None else None
            s1440_308 = (v1440_308 + a251) if v1440_308 is not None else None
            s1440_400 = (v1440_400 + a251) if v1440_400 is not None else None

    # If still missing everything, try -F as a fallback
    if all(x is None for x in [s144, s240, s360, s480, s720, s1080, s1440]):
        _dbg("sizes not found in -J; trying -F ...")
        out, err, code = run_ytdlp_list_formats(url)
        if code == 0 and out:
            sizes = parse_sizes_from_format_list(out)
            v144 = sizes.get("394")
            v240 = sizes.get("395")
            v360 = sizes.get("396")
            v480 = sizes.get("397")
            v720 = sizes.get("398")
            v1080 = sizes.get("399")
            v1440 = sizes.get("400")
            v1080_299 = sizes.get("299")
            v1080_303 = sizes.get("303")
            v1080_399 = sizes.get("399")
            v1440_308 = sizes.get("308")
            v1440_400 = sizes.get("400")
            a251 = sizes.get("251")
            s144 = (v144 + a251) if (v144 is not None and a251 is not None) else None
            s240 = (v240 + a251) if (v240 is not None and a251 is not None) else None
            s360 = (v360 + a251) if (v360 is not None and a251 is not None) else None
            s480 = (v480 + a251) if (v480 is not None and a251 is not None) else None
            s720 = (v720 + a251) if (v720 is not None and a251 is not None) else None
            s1080 = (v1080 + a251) if (v1080 is not None and a251 is not None) else None
            s1440 = (v1440 + a251) if (v1440 is not None and a251 is not None) else None
            s1080_299 = (v1080_299 + a251) if (v1080_299 is not None and a251 is not None) else None
            s1080_303 = (v1080_303 + a251) if (v1080_303 is not None and a251 is not None) else None
            s1080_399 = (v1080_399 + a251) if (v1080_399 is not None and a251 is not None) else None
            s1440_308 = (v1440_308 + a251) if (v1440_308 is not None and a251 is not None) else None
            s1440_400 = (v1440_400 + a251) if (v1440_400 is not None and a251 is not None) else None

    # Duration if still missing and no valid hint provided
    if dur_sec is None and not (isinstance(duration_hint, int) and duration_hint > 0):
        _dbg("fetching duration ...")
        dur_sec, d_err, d_code = run_ytdlp_get_duration(url)
        if d_code != 0:
            _dbg(f"duration fetch failed code={d_code} err={(d_err or '')[:200]}")
    elif dur_sec is None and isinstance(duration_hint, int) and duration_hint > 0:
        _dbg("skipping duration fetch due to valid duration_hint")
        dur_sec = duration_hint

    dur_h = humanize_duration(dur_sec)

    resp = {
        "ok": True,
        "bytes": {
            "s144p": s144,
            "s240p": s240,
            "s360p": s360,
            "s480p": s480,
            "s720p": s720,
            "s1080p": s1080,
            "s1440p": s1440,
            "v394": v144,
            "v395": v240,
            "v396": v360,
            "v397": v480,
            "v398": v720,
            "v399": v1080,
            "v400": v1440,
            "v299": v1080_299,
            "v303": v1080_303,
            "v308": v1440_308,
            "s1080p_299": s1080_299,
            "s1080p_303": s1080_303,
            "s1080p_399": s1080_399,
            "s1440p_308": s1440_308,
            "s1440p_400": s1440_400,
            "a251": a251
        },
        "human": {
            "s144p": humanize_bytes(s144) if s144 is not None else None,
            "s240p": humanize_bytes(s240) if s240 is not None else None,
            "s360p": humanize_bytes(s360) if s360 is not None else None,
            "s480p": humanize_bytes(s480) if s480 is not None else None,
            "s720p": humanize_bytes(s720) if s720 is not None else None,
            "s1080p": humanize_bytes(s1080) if s1080 is not None else None,
            "s1440p": humanize_bytes(s1440) if s1440 is not None else None,
            "s1080p_299": humanize_bytes(s1080_299) if s1080_299 is not None else None,
            "s1080p_303": humanize_bytes(s1080_303) if s1080_303 is not None else None,
            "s1080p_399": humanize_bytes(s1080_399) if s1080_399 is not None else None,
            "s1440p_308": humanize_bytes(s1440_308) if s1440_308 is not None else None,
            "s1440p_400": humanize_bytes(s1440_400) if s1440_400 is not None else None,
            "duration": dur_h
        },
        "duration": dur_sec,
    }
    _dbg("sending response")
    send_message(resp)


if __name__ == '__main__':
    main()

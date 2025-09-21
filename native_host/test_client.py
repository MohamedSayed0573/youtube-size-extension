#!/usr/bin/env python3
import json
import struct
import subprocess
import sys
import time
from pathlib import Path
import os

MANIFEST_PATH = Path(r"d:\extention\native_host\com.ytdlp.sizer.json")

def send_and_receive(host_cmd, payload: dict, timeout: float = 45.0):
    proc = subprocess.Popen(
        host_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        creationflags=0,
    )
    try:
        data = json.dumps(payload).encode("utf-8")
        header = struct.pack("<I", len(data))
        assert proc.stdin is not None
        proc.stdin.write(header)
        proc.stdin.write(data)
        proc.stdin.flush()

        assert proc.stdout is not None
        t0 = time.time()
        # Read 4-byte length
        hdr = b""
        while len(hdr) < 4:
            if time.time() - t0 > timeout:
                raise TimeoutError("Timeout waiting for response length header from host")
            chunk = proc.stdout.read(4 - len(hdr))
            if not chunk:
                break
            hdr += chunk
        if len(hdr) != 4:
            raise RuntimeError(f"Host closed without sending a response header (got {len(hdr)} bytes)")
        (msg_len,) = struct.unpack("<I", hdr)

        # Read message body
        body = b""
        while len(body) < msg_len:
            if time.time() - t0 > timeout:
                raise TimeoutError("Timeout waiting for response body from host")
            chunk = proc.stdout.read(msg_len - len(body))
            if not chunk:
                break
            body += chunk
        if len(body) != msg_len:
            raise RuntimeError(f"Incomplete message from host: expected {msg_len} bytes, got {len(body)} bytes")

        # Try to read any stderr without blocking
        try:
            proc_stderr = proc.stderr.read1(8192).decode("utf-8", errors="replace") if hasattr(proc.stderr, 'read1') else proc.stderr.read(8192).decode("utf-8", errors="replace")
        except Exception:
            proc_stderr = ""

        return body.decode("utf-8", errors="replace"), proc_stderr
    finally:
        # Let the host exit naturally
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()


def main():
    if len(sys.argv) < 2:
        print("Usage: py -3 test_client.py <YouTube_URL>")
        sys.exit(1)
    url = sys.argv[1]

    if not MANIFEST_PATH.exists():
        print(f"Manifest not found: {MANIFEST_PATH}")
        sys.exit(2)

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    host_path = manifest.get("path")
    if not host_path:
        print("No 'path' in manifest.")
        sys.exit(3)

    print(f"Using host: {host_path}")

    # If the host is a .cmd/.bat on Windows, launch via cmd.exe /c
    host_cmd = [host_path]
    if os.name == "nt":
        lower = host_path.lower()
        if lower.endswith(".cmd") or lower.endswith(".bat"):
            comspec = os.environ.get("COMSPEC", r"C:\\Windows\\System32\\cmd.exe")
            host_cmd = [comspec, "/c", host_path]

    try:
        response, stderr = send_and_receive(host_cmd, {"url": url})
    except Exception as e:
        print(f"[client] Error talking to host: {e}")
        sys.exit(4)

    print("\n--- Host Response ---")
    print(response)

    if stderr.strip():
        print("\n--- Host Stderr (debug) ---")
        print(stderr)


if __name__ == "__main__":
    main()

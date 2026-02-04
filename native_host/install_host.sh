#!/usr/bin/env bash
set -euo pipefail

# Install the native messaging host manifest for Chrome/Chromium and Firefox on Linux.
# Usage: ./install_host.sh <CHROME_EXT_ID>
# - For Chrome/Chromium, we still need the extension ID to populate allowed_origins.
# - For Firefox, we use the fixed Gecko ID declared in manifest.json:
#     ytdlp-sizer@example.com

HOST_NAME="com.ytdlp.sizer"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PY_HOST_PATH="${SCRIPT_DIR}/ytdlp_host.py"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <CHROME_EXT_ID>" >&2
  exit 1
fi
EXT_ID="$1"  # Chrome/Chromium extension ID
GECKO_ID="ytdlp-sizer@example.com"  # Must match manifest.json browser_specific_settings.gecko.id

if [[ ! -f "${PY_HOST_PATH}" ]]; then
  echo "Error: Python host not found at ${PY_HOST_PATH}" >&2
  exit 1
fi

chmod +x "${PY_HOST_PATH}" || true

# Determine config directories
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CHROME_DIRS=(
  "${CONFIG_HOME}/google-chrome/NativeMessagingHosts"
  "${CONFIG_HOME}/chromium/NativeMessagingHosts"
  "${CONFIG_HOME}/microsoft-edge/NativeMessagingHosts"
)
FIREFOX_DIR="${HOME}/.mozilla/native-messaging-hosts"

MANIFEST_JSON_NAME="${HOST_NAME}.json"

# Create manifest content (Chrome/Chromium)
read -r -d '' MANIFEST_CONTENT <<JSON || true
{
  "name": "${HOST_NAME}",
  "description": "Native host to run yt-dlp -F and return 480p/720p sizes.",
  "path": "${PY_HOST_PATH}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXT_ID}/"
  ]
}
JSON

for dir in "${CHROME_DIRS[@]}"; do
  mkdir -p "$dir"
  echo "Installing manifest to $dir/${MANIFEST_JSON_NAME}"
  printf '%s\n' "$MANIFEST_CONTENT" > "$dir/${MANIFEST_JSON_NAME}"

done

# Create manifest content (Firefox)
read -r -d '' FF_MANIFEST_CONTENT <<JSON || true
{
  "name": "${HOST_NAME}",
  "description": "Native host to run yt-dlp -F and return 480p/720p sizes.",
  "path": "${PY_HOST_PATH}",
  "type": "stdio",
  "allowed_extensions": [
    "${GECKO_ID}"
  ]
}
JSON

mkdir -p "${FIREFOX_DIR}"
echo "Installing Firefox manifest to ${FIREFOX_DIR}/${MANIFEST_JSON_NAME}"
printf '%s\n' "$FF_MANIFEST_CONTENT" > "${FIREFOX_DIR}/${MANIFEST_JSON_NAME}"

echo "Checking for yt-dlp..."
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "Warning: yt-dlp not found in PATH. Please install it, e.g.:" >&2
  echo "  pipx install yt-dlp    # or" >&2
  echo "  pip3 install --user yt-dlp    # or" >&2
  echo "  sudo apt-get install yt-dlp" >&2
fi

echo "Done. Restart your browsers if needed."
echo "If the popup reports host connection errors:"
echo " - For Chrome/Chromium: ensure the extension ID matches and manifests exist under:"
echo "     ${CONFIG_HOME}/google-chrome/NativeMessagingHosts/${MANIFEST_JSON_NAME}"
echo "     ${CONFIG_HOME}/chromium/NativeMessagingHosts/${MANIFEST_JSON_NAME}"
echo " - For Firefox: ensure the manifest exists under:"
echo "     ${FIREFOX_DIR}/${MANIFEST_JSON_NAME}"

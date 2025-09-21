# Package the Firefox MV3 extension into a signed-ready XPI
# - Uses manifest.firefox.prod.json (MV3 compliant for AMO) as manifest.json in the build
# - Outputs ytdlp-sizer-firefox.xpi at the repo root

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Build = Join-Path $Root 'build\firefox'
$OutXpi = Join-Path $Root 'ytdlp-sizer-firefox.xpi'
$OutZip = Join-Path $Root 'ytdlp-sizer-firefox.zip'

# Clean build folder
if (Test-Path $Build) {
  Remove-Item -Recurse -Force $Build
}
New-Item -ItemType Directory -Force -Path $Build | Out-Null

# Files to include at root of XPI
$include = @(
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'youtube.png',
  'manifest.firefox.prod.json',
  'README.md'
)

foreach ($f in $include) {
  $src = Join-Path $Root $f
  if (Test-Path $src) {
    Copy-Item -Force $src -Destination (Join-Path $Build (Split-Path $src -Leaf))
  }
}

# NOTE: Excluding native_host/ from AMO package because AMO rejects entries
# with backslashes in archive paths (Windows default). Ship host installers
# separately (e.g., in a GitHub release) if needed.

# Replace manifest.firefox.prod.json -> manifest.json
$mfSrc = Join-Path $Build 'manifest.firefox.prod.json'
$mfDst = Join-Path $Build 'manifest.json'
if (-not (Test-Path $mfSrc)) {
  throw "manifest.firefox.prod.json not found in $Build"
}
Copy-Item -Force $mfSrc $mfDst
Remove-Item -Force $mfSrc

# Create XPI (zip) from build contents (files at root)
# Compress-Archive only supports .zip; create .zip then copy to .xpi for AMO
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
if (Test-Path $OutXpi) { Remove-Item -Force $OutXpi }
Compress-Archive -Path (Join-Path $Build '*') -DestinationPath $OutZip -Force
Copy-Item -Force $OutZip $OutXpi

Write-Host "Created: $OutZip and $OutXpi"

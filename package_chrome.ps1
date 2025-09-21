# Package the Chrome MV3 extension into a ZIP for upload to Chrome Web Store
# - Uses manifest.chrome.prod.json as manifest.json in the build
# - Outputs ytdlp-sizer-chrome.zip at the repo root

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Build = Join-Path $Root 'build\chrome'
$OutZip = Join-Path $Root 'ytdlp-sizer-chrome.zip'

# Clean build folder
if (Test-Path $Build) {
  Remove-Item -Recurse -Force $Build
}
New-Item -ItemType Directory -Force -Path $Build | Out-Null

# Files to include at root of ZIP
$include = @(
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'youtube.png',
  'manifest.chrome.prod.json',
  'README.md'
)

foreach ($f in $include) {
  $src = Join-Path $Root $f
  if (Test-Path $src) {
    Copy-Item -Force $src -Destination (Join-Path $Build (Split-Path $src -Leaf))
  }
}

# NOTE: Excluding native_host/ from Chrome package because it's not needed for the extension ZIP.
# Native host installation is done separately on the user's machine.

# Replace manifest.chrome.prod.json -> manifest.json
$mfSrc = Join-Path $Build 'manifest.chrome.prod.json'
$mfDst = Join-Path $Build 'manifest.json'
if (-not (Test-Path $mfSrc)) {
  throw "manifest.chrome.prod.json not found in $Build"
}
Copy-Item -Force $mfSrc $mfDst
Remove-Item -Force $mfSrc

# Create ZIP from build contents
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
Compress-Archive -Path (Join-Path $Build '*') -DestinationPath $OutZip -Force

Write-Host "Created: $OutZip"

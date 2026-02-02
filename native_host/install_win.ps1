param(
  [Parameter(Mandatory = $true)]
  [string]$StoreId,
  [string[]]$DevIds = @(),
  [string]$InstallDir = "$env:LOCALAPPDATA\YouTubeSizeNative",
  [switch]$SkipDownloadYtDlp,
  [switch]$NoChrome,
  [switch]$NoEdge,
  [switch]$NoChromium,
  [switch]$NoFirefox
)

Write-Host "[install] Installing native host to: $InstallDir"

# Ensure install directory exists
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Source directory (this script's folder)
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path

# Copy host files
$filesToCopy = @(
  'ytdlp_host.cmd',
  'ytdlp_host.exe',
  'ytdlp_host.py',
  'yt-dlp.exe'
)
foreach ($f in $filesToCopy) {
  $srcPath = Join-Path $Src $f
  if (Test-Path $srcPath) {
    Copy-Item -Force $srcPath (Join-Path $InstallDir $f)
  }
}

# Download yt-dlp.exe if not present and not skipped
$ytLocal = Join-Path $InstallDir 'yt-dlp.exe'
if (-not (Test-Path $ytLocal) -and -not $SkipDownloadYtDlp) {
  try {
    Write-Host "[install] Downloading yt-dlp.exe to $ytLocal"
    $ytUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    Invoke-WebRequest -Uri $ytUrl -OutFile $ytLocal -UseBasicParsing -TimeoutSec 60
  } catch {
    Write-Warning "Failed to download yt-dlp.exe automatically. You can place it manually at $ytLocal"
  }
}

# Build allowed_origins for Chrome/Chromium/Edge (Chromium-based Edge uses chrome-extension:// scheme)
$allowedOrigins = @("chrome-extension://$StoreId/")
if ($DevIds) {
  foreach ($id in $DevIds) {
    if ([string]::IsNullOrWhiteSpace($id)) { continue }
    $allowedOrigins += "chrome-extension://$id/"
  }
}

# Write Chrome/Chromium/Edge JSON manifest in install dir
$chromeJsonPath = Join-Path $InstallDir 'com.ytdlp.sizer.json'
$hostCmdPath = Join-Path $InstallDir 'ytdlp_host.cmd'
$chromeObj = [ordered]@{
  name = 'com.ytdlp.sizer'
  description = 'Native host to run yt-dlp and return video sizes.'
  path = $hostCmdPath
  type = 'stdio'
  allowed_origins = $allowedOrigins
}
$chromeObj | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 -FilePath $chromeJsonPath

# Write Firefox JSON manifest in install dir
$ffJsonPath = Join-Path $InstallDir 'com.ytdlp.sizer.firefox.json'
$ffObj = [ordered]@{
  name = 'com.ytdlp.sizer'
  description = 'Native host to run yt-dlp and return video sizes.'
  path = $hostCmdPath
  type = 'stdio'
  allowed_extensions = @('ytdlp-sizer@example.com')
}
$ffObj | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 -FilePath $ffJsonPath

# Helper: register registry key
function Register-HostJson([string]$RootKeyPath, [string]$JsonPath) {
  try {
    if (-not (Test-Path $RootKeyPath)) {
      New-Item -Path $RootKeyPath -Force | Out-Null
    }
    Set-ItemProperty -Path $RootKeyPath -Name '(default)' -Value $JsonPath -Force
    Write-Host "[install] Registered: $RootKeyPath -> $JsonPath"
  } catch {
    Write-Warning "Failed to register $RootKeyPath: $_"
  }
}

# Register for Chrome
if (-not $NoChrome) {
  $k = 'HKCU:Software\\Google\\Chrome\\NativeMessagingHosts\\com.ytdlp.sizer'
  Register-HostJson -RootKeyPath $k -JsonPath $chromeJsonPath
}

# Register for Microsoft Edge (Chromium-based)
if (-not $NoEdge) {
  $k = 'HKCU:Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.ytdlp.sizer'
  Register-HostJson -RootKeyPath $k -JsonPath $chromeJsonPath
}

# Register for Chromium (optional)
if (-not $NoChromium) {
  $k = 'HKCU:Software\\Chromium\\NativeMessagingHosts\\com.ytdlp.sizer'
  Register-HostJson -RootKeyPath $k -JsonPath $chromeJsonPath
}

# Register for Firefox
if (-not $NoFirefox) {
  $k = 'HKCU:Software\\Mozilla\\NativeMessagingHosts\\com.ytdlp.sizer'
  Register-HostJson -RootKeyPath $k -JsonPath $ffJsonPath
}

Write-Host "[install] Done. Summary:"
Write-Host "  Install dir: $InstallDir"
Write-Host "  Host launcher: $hostCmdPath (prefers ytdlp_host.exe if present)"
Write-Host "  Chrome/Edge/Chromium manifest: $chromeJsonPath"
Write-Host "  Firefox manifest: $ffJsonPath"
Write-Host "  Allowed origins: $($allowedOrigins -join ', ')"

# Sanity checks
if (-not (Test-Path (Join-Path $InstallDir 'ytdlp_host.exe'))) {
  Write-Warning "ytdlp_host.exe not found in install dir. The .cmd will fall back to Python. To avoid requiring Python for users, build the EXE (see build_host.ps1)."
}
if (-not (Test-Path $ytLocal)) {
  Write-Warning "yt-dlp.exe not found in install dir. Host will fall back to PATH. Place yt-dlp.exe at $ytLocal to avoid PATH dependency."
}

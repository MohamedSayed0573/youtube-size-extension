param(
    [string]$PythonLauncher = "py",
    [string]$HostName = "ytdlp_host"
)

Write-Host "[build] Starting production host build..."

# Move to script directory
Set-Location -Path $PSScriptRoot

# 1) Detect Python
$pythonCmd = $null
if (Get-Command $PythonLauncher -ErrorAction SilentlyContinue) {
  $pythonCmd = $PythonLauncher
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonCmd = "python"
}

if (-not $pythonCmd) {
  Write-Error "Python 3 is required to build the host. Please install Python 3 and try again."
  exit 1
}

# 2) Ensure PyInstaller is available
Write-Host "[build] Ensuring PyInstaller is installed..."
& $pythonCmd -m pip install --upgrade pip | Out-Host
& $pythonCmd -m pip install --upgrade pyinstaller | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to install PyInstaller."
  exit 2
}

# 3) Build single-file executable
Write-Host "[build] Building $HostName.exe with PyInstaller..."
Remove-Item -Recurse -Force .\build, .\dist, .\__pycache__ -ErrorAction SilentlyContinue
& $pythonCmd -m PyInstaller -F -n $HostName --clean "ytdlp_host.py" | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Error "PyInstaller build failed."
  exit 3
}

# 4) Copy executable next to the launcher script
$exePath = Join-Path -Path (Join-Path $PSScriptRoot "dist") "$HostName.exe"
if (-not (Test-Path $exePath)) {
  Write-Error "Built executable not found: $exePath"
  exit 4
}
Copy-Item -Force $exePath (Join-Path $PSScriptRoot "$HostName.exe")

# 5) Fetch yt-dlp.exe next to the host for production reliability
$ytDlpLocal = Join-Path $PSScriptRoot "yt-dlp.exe"
if (-not (Test-Path $ytDlpLocal)) {
  Write-Host "[build] Downloading yt-dlp.exe..."
  $ytUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  try {
    Invoke-WebRequest -Uri $ytUrl -OutFile $ytDlpLocal -UseBasicParsing
  } catch {
    Write-Warning "Failed to download yt-dlp.exe automatically. Please download it manually from $ytUrl and place it at $ytDlpLocal"
  }
}

# 6) Cleanup build artifacts (optional)
Remove-Item -Recurse -Force .\build, .\dist, .\__pycache__, .\$HostName.spec -ErrorAction SilentlyContinue

Write-Host "[build] Done. Outputs:"
Write-Host "  - $(Join-Path $PSScriptRoot "$HostName.exe")"
Write-Host "  - $(Join-Path $PSScriptRoot "yt-dlp.exe") (if download succeeded)"
Write-Host "[build] The manifest currently points to ytdlp_host.cmd, which prefers the EXE if present. No registry changes needed."

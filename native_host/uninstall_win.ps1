param(
  [string]$InstallDir = "$env:LOCALAPPDATA\YouTubeSizeNative",
  [switch]$KeepBinaries
)

Write-Host "[uninstall] Removing native host registration and files from: $InstallDir"

function Unregister-HostJson([string]$RootKeyPath) {
  try {
    if (Test-Path $RootKeyPath) {
      Remove-Item -Path $RootKeyPath -Recurse -Force
      Write-Host "[uninstall] Removed: $RootKeyPath"
    }
  } catch {
    Write-Warning "Failed to remove $RootKeyPath: $_"
  }
}

# Remove registry keys
Unregister-HostJson -RootKeyPath 'HKCU:Software\Google\Chrome\NativeMessagingHosts\com.ytdlp.sizer'
Unregister-HostJson -RootKeyPath 'HKCU:Software\Microsoft\Edge\NativeMessagingHosts\com.ytdlp.sizer'
Unregister-HostJson -RootKeyPath 'HKCU:Software\Chromium\NativeMessagingHosts\com.ytdlp.sizer'
Unregister-HostJson -RootKeyPath 'HKCU:Software\Mozilla\NativeMessagingHosts\com.ytdlp.sizer'

# Remove install directory (optional)
if (-not $KeepBinaries) {
  try {
    if (Test-Path $InstallDir) {
      Remove-Item -Recurse -Force $InstallDir
      Write-Host "[uninstall] Deleted directory: $InstallDir"
    }
  } catch {
    Write-Warning "Failed to delete $InstallDir: $_"
  }
} else {
  Write-Host "[uninstall] Keeping binaries at $InstallDir (per --KeepBinaries)."
}

Write-Host "[uninstall] Done."

@echo off
setlocal

REM Determine the directory of this script for portability
set "DIR=%~dp0"

REM Prefer compiled EXE for production reliability/performance
if exist "%DIR%ytdlp_host.exe" (
  "%DIR%ytdlp_host.exe"
  exit /b %errorlevel%
)

REM Development fallback: run the Python script with unbuffered stdio
set "SCRIPT=%DIR%ytdlp_host.py"

REM Prefer the Python launcher (installed with Python). -u = unbuffered stdio (required for native messaging).
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -u "%SCRIPT%"
  exit /b %errorlevel%
)

REM Fallback to python if launcher is missing
python -u "%SCRIPT%"
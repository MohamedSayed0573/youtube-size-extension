@echo off
setlocal
set "SCRIPT=D:\extention\native_host\ytdlp_host.py"

REM Prefer the Python launcher (installed with Python). -u = unbuffered stdio (required for native messaging).
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -u "%SCRIPT%"
  exit /b %errorlevel%
)

REM Fallback to python if launcher is missing
python -u "%SCRIPT%"
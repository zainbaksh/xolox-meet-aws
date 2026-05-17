@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Checking Node dependencies...
if not exist node_modules (
  call npm install
) else (
  call npm install >nul
)

echo [2/5] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
  echo Python not found. Please install Python 3.10+ and re-run.
  exit /b 1
)

echo [3/5] Installing transcription dependencies from requirements.txt...
python -m pip install -r requirements.txt

echo [4/5] Ensuring FFmpeg is installed...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
  winget install --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
)

echo [5/5] Starting Xolox Meet...
start "Xolox Meet Server" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 2 >nul
echo Starting ngrok tunnel...
ngrok http 3000 --host-header=rewrite

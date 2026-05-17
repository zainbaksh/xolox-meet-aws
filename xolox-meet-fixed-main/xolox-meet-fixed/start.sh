#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "[1/4] Installing Node dependencies..."
npm install

echo "[2/4] Installing Python dependencies from requirements.txt..."
if command -v python3 >/dev/null 2>&1; then
  python3 -m pip install -r requirements.txt
elif command -v python >/dev/null 2>&1; then
  python -m pip install -r requirements.txt
else
  echo "Python not found. Install Python 3.10+ and re-run."
  exit 1
fi

echo "[3/4] Checking FFmpeg..."
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg not found on PATH. Install ffmpeg to enable transcription."
fi

echo "[4/4] Starting Xolox Meet server..."
node server.js &
SERVER_PID=$!
sleep 2
echo "Starting ngrok tunnel..."
ngrok http 3000 --host-header=rewrite
kill $SERVER_PID

#!/usr/bin/env bash
# 2jz install script for Linux (Debian/Ubuntu and Fedora)
# Usage: bash install-linux.sh
set -e

echo "2jz -- media downloader installer"
echo "----------------------------------"

# -- Node.js check -----------------------------------------------------------
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_VER=$(node --version | tr -d 'v')
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js >= 18 required. Found v$NODE_VER"
  exit 1
fi

echo "[ok] Node.js v$NODE_VER"

# -- 2jz install -------------------------------------------------------------
echo "Installing 2jz-media-downloader..."
npm install -g 2jz-media-downloader

echo "[ok] 2jz installed"

# -- yt-dlp ------------------------------------------------------------------
if ! command -v yt-dlp &>/dev/null; then
  echo "Installing yt-dlp..."
  if command -v pip3 &>/dev/null; then
    pip3 install --user yt-dlp
  elif command -v pip &>/dev/null; then
    pip install --user yt-dlp
  else
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod +x /usr/local/bin/yt-dlp
  fi
  echo "[ok] yt-dlp installed"
else
  echo "[ok] yt-dlp already installed: $(yt-dlp --version)"
fi

# -- ffmpeg ------------------------------------------------------------------
if ! command -v ffmpeg &>/dev/null; then
  echo "Installing ffmpeg..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y ffmpeg
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y ffmpeg
  else
    echo "WARNING: Could not install ffmpeg automatically. Install it manually."
  fi
else
  echo "[ok] ffmpeg already installed"
fi

echo ""
echo "Installation complete. Run: 2jz"

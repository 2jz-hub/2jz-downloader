#!/usr/bin/env bash
# 2jz install script for macOS (requires Homebrew)
# Usage: bash install-macos.sh
set -e

echo "2jz -- media downloader installer (macOS)"
echo "------------------------------------------"

# -- Homebrew ----------------------------------------------------------------
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Install from https://brew.sh and re-run this script."
  exit 1
fi

# -- Node.js -----------------------------------------------------------------
if ! command -v node &>/dev/null; then
  echo "Installing Node.js..."
  brew install node@20
  brew link node@20
fi

NODE_VER=$(node --version | tr -d 'v')
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js >= 18 required. Found v$NODE_VER"
  exit 1
fi

echo "[ok] Node.js v$NODE_VER"

# -- 2jz ---------------------------------------------------------------------
echo "Installing 2jz-media-downloader..."
npm install -g 2jz-media-downloader
echo "[ok] 2jz installed"

# -- yt-dlp & ffmpeg ---------------------------------------------------------
echo "Installing yt-dlp and ffmpeg via Homebrew..."
brew install yt-dlp ffmpeg
echo "[ok] yt-dlp and ffmpeg installed"

echo ""
echo "Installation complete. Run: 2jz"

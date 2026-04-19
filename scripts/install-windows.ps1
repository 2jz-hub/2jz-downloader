# 2jz install script for Windows (PowerShell)
# Run as: powershell -ExecutionPolicy Bypass -File install-windows.ps1

Write-Host "2jz -- media downloader installer (Windows)"
Write-Host "--------------------------------------------"

# -- Check Node.js -----------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js not found. Installing via winget..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
}

$nodeVer = (node --version).TrimStart("v")
$major = [int]($nodeVer.Split(".")[0])
if ($major -lt 18) {
    Write-Host "ERROR: Node.js >= 18 required. Found v$nodeVer"
    exit 1
}
Write-Host "[ok] Node.js v$nodeVer"

# -- 2jz ---------------------------------------------------------------------
Write-Host "Installing 2jz-media-downloader..."
npm install -g 2jz-media-downloader
Write-Host "[ok] 2jz installed"

# -- yt-dlp ------------------------------------------------------------------
$ytdlp = Get-Command yt-dlp -ErrorAction SilentlyContinue
if (-not $ytdlp) {
    Write-Host "Installing yt-dlp..."
    winget install -e --id yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements
}
Write-Host "[ok] yt-dlp installed"

# -- ffmpeg ------------------------------------------------------------------
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ff) {
    Write-Host "Installing ffmpeg..."
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
}
Write-Host "[ok] ffmpeg installed"

Write-Host ""
Write-Host "Installation complete. Run: 2jz"

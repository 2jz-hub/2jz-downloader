# 🏎️ 2jz-downloader
> **The ultimate interactive CLI media downloader for power users.**

[![npm version](https://img.shields.io/npm/v/2jz-media-downloader?color=red&style=for-the-badge)](https://www.npmjs.com/package/2jz-media-downloader)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dt/2jz-media-downloader?color=green&style=for-the-badge)](https://www.npmjs.com/package/2jz-media-downloader)

---

### ✨ Why 2jz?
**2jz** is not just a wrapper; it's a high-performance engine for your media needs. Built on top of `yt-dlp`, it provides a beautiful, interactive Terminal User Interface (TUI) that makes downloading from 1000+ sites as simple as a few keystrokes.

#### 🚀 Key Benefits
- ⚡ **Turbocharged Speed**: Multi-threaded batch downloads.
- 🎨 **Beautiful TUI**: No more memorizing complex flags—use the interactive menu.
- 🛠️ **Zero Config Setup**: Auto-installs `yt-dlp` and `ffmpeg` for you.
- 📱 **Termux Optimized**: Works flawlessly on Android/Termux, Linux, macOS, and Windows.
- 🔒 **Privacy Focused**: Use your own cookies for private content without exposing credentials.

---

### 📦 Installation
```bash
npm install -g 2jz-media-downloader
```

---

### 🎮 Quick Start
| Action | Command |
| :--- | :--- |
| **Interactive Mode** | `2jz` |
| **Instant Download** | `2jz <url>` |
| **Audio Only (MP3)** | `2jz <url> -m audio -f mp3` |
| **Batch Mode** | `2jz --batch list.txt` |

---

### ❓ Questions & Answers (FAQ)

**Q: Which sites are supported?**  
**A:** Over 1000+ sites including YouTube, Instagram, TikTok (no watermark), Twitter/X, Reddit, and SoundCloud.

**Q: Do I need to install yt-dlp or ffmpeg manually?**  
**A:** No. On first run, 2jz will offer to install these for you automatically.

**Q: How do I download age-restricted or private content?**  
**A:** Use the `--cookies path/to/cookies.txt` flag or set your cookies file in the Interactive Settings.

**Q: Is it safe to use?**  
**A:** 100%. It’s open-source, MIT licensed, and runs entirely on your local machine.

---

### 🛠️ Advanced Usage
```bash
2jz <url> -q 1080p -f mp4 --subtitles    # High quality with subs
2jz <url> --embed-thumbnail              # Perfect for music libraries
2jz update                               # Keep the engine running with latest yt-dlp
```

---

### 🤝 Contributing
Found a bug? Have a feature request? Open an [issue](https://github.com/2jz-hub/2jz-downloader/issues) or submit a PR!

**MIT © [2jz-hub](https://github.com/2jz-hub)**

# ⏳ Kairos — Better Chapters for YouTube

> *"Chronos is the quantitative time of clocks and hours; Kairos is the qualitative moment of focus and purpose."*

**Kairos** is an ultra-lightweight, privacy-first browser extension for Firefox and Chromium browsers (Chrome, Brave, Edge) that transforms exhausting multi-hour YouTube videos and courses into clean, digestible chapters with isolated progress bars, an intelligent playlist sidebar, collapsible sub-chapters, and optional Gemini AI chapters.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Repository](https://img.shields.io/badge/GitHub-te4los%2FKairos-181717.svg?logo=github)](https://github.com/te4los/Kairos)
[![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B.svg?logo=kofi)](https://ko-fi.com/xveazn)
[![Firefox & Chromium](https://img.shields.io/badge/Browsers-Firefox%20%7C%20Chromium-orange.svg)](#installation)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

---

## Features

- ⏱ **Isolated Timeline & Duration**: Displays only the duration of the current chapter (e.g. `03:15 / 24:10`) in a frosted-glass capsule rather than the overwhelming full video clock.
- ⚡ **Hardware-Accelerated Progress Bar**: Silky smooth scrubber mapped 0% to 100% of the active chapter with zero lag or layout reflows.
- 📋 **Chapters Playlist Sidebar**: A clean, distraction-free playlist with 16:9 chapter thumbnails, duration badges, and completion checkmarks (`✓`).
- 📂 **Collapsible Sub-chapters & Topics**: Long chapters (e.g., 2-hour university lectures) are neatly structured with drop-down sub-topics, glowing active indicators, and seamless continuous playback.
- 🤖 **Gemini AI Chapters (Optional)**: Automatically analyze transcripts to generate semantic chapters and sub-topics with zero clutter using Google Gemini (`gemini-3.8-flash` / `gemini-2.5-flash`).
- ⏸ **Smart Chapter Completion**: Optionally pause when a main chapter ends, or let it flow seamlessly. Never interrupts in the middle of sentences.
- 🛡 **Unhook & Adblock Compatible**: Works seamlessly even when extensions like Unhook hide the YouTube recommendations sidebar.
- 🔒 **100% Private & Open Source**: Zero tracking, zero telemetry, local storage only.

---

## 📂 Repository Structure

```text
Kairos/
├── firefox/       # Manifest V3 extension ready for Firefox
├── chromium/      # Manifest V3 extension ready for Chrome, Brave, Edge
├── LICENSE        # MIT License
└── README.md      # Documentation & Guide
```

---

## 🚀 Installation

### For Firefox
1. Clone or download this repository.
2. Open Firefox and go to: `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."** and select the `manifest.json` file inside the `firefox/` folder.

### For Chrome, Brave, Edge, Opera, Vivaldi (Chromium)
1. Clone or download this repository.
2. Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions/`
   - **Brave**: `brave://extensions/`
   - **Edge**: `edge://extensions/`
3. Toggle **"Developer mode"** in the top-right corner.
4. Click **"Load unpacked"** and select the `chromium/` folder.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Shift + C` | Toggle Kairos ON / OFF |
| `Shift + N` | Jump to Next Chapter |
| `Shift + P` | Jump to Previous Chapter |

---

## 💖 Support & Contributions

If Kairos helps your learning and productivity:
- ⭐ **Star this repository** on [GitHub](https://github.com/te4los/Kairos)!
- ☕ **Support on Ko-fi**: [ko-fi.com/xveazn](https://ko-fi.com/xveazn)
- 🐛 Report bugs or submit feature ideas via [GitHub Issues](https://github.com/te4los/Kairos/issues).

---

## 👨‍💻 Author & Credits

Created and developed with care by **Zeyn** ([@te4los](https://github.com/te4los)).  
Copyright © 2026 **Zeyn**. All rights reserved.

---

## 📄 License
Licensed under the [MIT License](LICENSE). © 2026 Zeyn.

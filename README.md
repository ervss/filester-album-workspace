# Filester Album Workspace (Standalone Edition)

[![Version](https://img.shields.io/badge/version-2.0.0-22c55e.svg)](https://github.com/ervss/filester-album-workspace)
[![Author](https://img.shields.io/badge/author-ervss-8b5cf6.svg)](https://github.com/ervss)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Install Userscript](https://img.shields.io/badge/Install-Tampermonkey%20%2F%20Violentmonkey-brightgreen?logo=tampermonkey)](https://raw.githubusercontent.com/ervss/filester-album-workspace/main/filester-album-workspace-standalone.user.js)

Created by **[ervss](https://github.com/ervss)** — **Filester Album Workspace** is a self-contained power-user userscript that transforms any public Filester folder (`/f/...`) or your personal Filester File Manager (`/manager`) into a fast, responsive media curation & playback workspace.

This **Standalone Edition (v2.0.0)** runs **100% in your browser**—no local server, Python backend, or companion scripts are required.

---

## ⚡ One-Click Installation

1. Install a userscript manager extension in your browser:
   - **[Tampermonkey](https://www.tampermonkey.net/)** (Recommended for Chrome, Edge, Brave, Firefox, Safari)
   - **[Violentmonkey](https://violentmonkey.github.io/)** (Open-source alternative)
2. **[👉 Click Here to Install `filester-album-workspace-standalone.user.js` (1-Click Raw Link)](https://raw.githubusercontent.com/ervss/filester-album-workspace/main/filester-album-workspace-standalone.user.js)**
3. Confirm installation in Tampermonkey / Violentmonkey. Automatic updates are pre-configured via GitHub!
4. Open any Filester folder (`https://filester.me/f/...`, `filester.gg/f/...`, `filester.si/f/...`, `filester.sh/f/...`) or your File Manager (`https://filester.me/manager`).

---

## ✨ Key Features

- **6 Responsive Widescreen Grid Layouts:** Switch instantly between `Mini`, `Compact`, `Overview`, `Large`, `Cinema`, and `Max` (Poster) 16:9 views that utilize 96% of your viewport width.
- **Advanced Search & Boolean Filtering:**
  - Instant search across filenames with support for exact phrases (`"exact match"`) and negative exclusion tokens (`-trailer -sample`).
  - Filter by **Resolution Tier** (`4K`, `1440p`, `1080p`, `720p`, `SD`, `Unknown`).
  - Filter by **Duration** (`min` / `max` minutes) and **File Size** (`from` / `to` MB).
  - Toggle **Unreviewed Only** (`○ Unreviewed`) or **Selected Only** (`☑ Selected Only`).
- **10 Custom Sort Modes:** Sort in-place without reloading the page by *Newest*, *Oldest*, *Name (A–Z / Z–A)*, *File Size (Largest / Smallest)*, *Duration (Longest / Shortest)*, or *Quality (Best / Lowest)*.
- **Direct Browser Metadata Probing:**
  - Click **Probe Selected** or **Probe Visible** to query Filester's public endpoints directly from your browser.
  - Automatically discovers exact **video duration**, **native resolution**, **upload date**, **direct CDN stream link**, and calculates a **Bitrate Density Score** (`HQ`, `OK`, `LOW`) so you can spot heavily compressed re-encodes before downloading.
- **In-Page Modal Video Player:**
  - Click the `▶` button on any video thumbnail to watch it immediately inside a sleek modal player.
  - Navigate across visible videos with `◀ Prev` / `Next ▶` (or `Alt + ←` / `Alt + →`), toggle selection/review status, or copy the stream link right from the player header.
- **Built-in Multi-Video Split-Screen Wall:**
  - Select up to **12 videos** and click **▶▶ Split-Screen** (or click `▦` on a card) to compare and watch multiple streams side-by-side.
  - Hover over any video tile to solo its audio automatically, or use the top bar to Play All, Pause All, or Mute All.
- **Bulk Export & External Player Integration:**
  - **Copy Page URLs:** Copies standard `https://filester.me/d/...` links for all selected files.
  - **Copy Direct URLs:** Automatically resolves and copies raw CDN video stream URLs (ideal for JDownloader 2, IDM, Aria2, or `yt-dlp`).
  - **Export .M3U Playlist:** Generates a ready-to-play `.m3u8` playlist file with titles and durations that opens directly in **VLC**, **MPV**, **IINA**, or **PotPlayer**.
  - **Export JSON:** Saves complete structured metadata (titles, slugs, stream URLs, sizes, resolutions, timestamps) to a `.json` file.
- **Save to Account (`Save to Account`):** Batch-saves selected files from any public album directly into your own logged-in Filester account with a single click.
- **Album State & Scroll Memory:** Remembers if you clicked *"Load all pages"* and automatically restores your exact scroll position when navigating back from a file page.

---

## ⌨️ Keyboard Shortcuts & Mouse Controls

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Select / Deselect file** | Click anywhere on the video **thumbnail** (or top-left checkbox) |
| **Select a range of files** | Hold <kbd>Shift</kbd> + Click on another thumbnail |
| **Open file page (`/d/...`)** | Click on the **file title** below the thumbnail |
| **Focus search input** | Press <kbd>/</kbd> |
| **Select all visible files** | Press <kbd>Shift</kbd> + <kbd>A</kbd> |
| **Invert visible selection** | Press <kbd>Shift</kbd> + <kbd>I</kbd> |
| **Clear selection** | Press <kbd>Shift</kbd> + <kbd>C</kbd> |
| **Show Shortcuts & Tips Help** | Press <kbd>?</kbd> (or click `?` in the top-right of the toolbar) |
| **Previous / Next video in Player** | Press <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd> |
| **Close active Player / Split-Screen** | Press <kbd>Esc</kbd> |

---

## 💡 Pro Tips & Tricks

1. **Smart Search Filtering:**
   Combine positive keywords, exact phrases, and exclusions in the search box. For example:
   ```text
   1080p "episode 1" -cam -trailer
   ```
   This immediately filters the grid to show only items matching `1080p` and `"episode 1"`, while hiding anything containing `cam` or `trailer`.

2. **Understanding Bitrate Density Badges (`HQ` / `OK` / `LOW`):**
   A "1080p" label in a filename doesn't guarantee high visual quality. Once you run **Probe Selected** or **Probe Visible**, the script calculates the actual megabits-per-second (Mbps) relative to the video's resolution:
   - 🟢 **HQ:** High bitrate density (crisp encoding).
   - 🟡 **OK:** Standard web streaming bitrate.
   - 🔴 **LOW:** Heavily compressed / bit-starved video.

3. **Stream Entire Albums in VLC or MPV Without Downloading:**
   Select the videos you want (`Shift + A`), click **Export .M3U**, and open the downloaded `.m3u8` file in VLC, IINA, PotPlayer, or MPV. Your desktop media player will stream the videos directly from Filester's CDN with full playlist navigation!

4. **Upgrade Blurry Thumbnails with HD Previews:**
   Default Filester thumbnails are often low-resolution or poorly timed. Select a few videos and click **HD Previews**—the script will seek ~10–15% into the actual video stream and capture a sharp frame right inside your browser.

5. **Review Workflow for Huge Multi-Page Folders:**
   When auditing folders with hundreds of files, click the `○` button in the bottom-right corner of cards you've already checked (it turns green `✓`), then enable the **○ Unreviewed** toggle on the toolbar. Even if you close the tab and come back days later, your reviewed checkpoints are saved per-album in `localStorage`.

---

## 📄 License

Released under the [MIT License](./LICENSE) by **[ervss](https://github.com/ervss)**.

# Changelog

All notable changes to **Filester Album Workspace (Standalone Edition)** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0] - 2026-11-09

### Added
- **Subfolders Probing & Metadata Extraction:**
  - Automated detection of subfolder cards (`.subfolder-item`) on public Filester albums.
  - Background asynchronous querying of each subfolder's total size, creation date, and newest upload date.
  - Accurate calculation of true total file count and page count (e.g. `121 files across 6 pages`), bypassing Filester's 24-files-per-page display cap.
- **Folder Toolbar:**
  - Automatically unhides all subfolders, removing Filester's default 5-folder cap.
  - Instant text search input (`Filter folders…`) to filter subfolders by name in real time.
  - 7 sorting algorithms: Original order, Name A–Z, Name Z–A, Largest size ↓, Smallest size ↑, Most files ↓, and Newest upload ↓.
  - Quick action buttons: `Select All`, `Clear Selection`, and `↻ Refresh`.
- **Floating Folder Action Dock:**
  - Responsive bottom dock that activates whenever 1 or more folders are selected.
  - Live summary of selected folder count, total file count, and aggregated storage size.
  - Action buttons:
    - `🗂 Merge on this page` — Activates the Virtual Merged Album on the current page.
    - `⧉ In new tab` — Opens the merged album in a new browser tab with `#merge=` hash.
    - `⬇ Download ZIP` — Downloads selected folders as ZIP archives via Filester's `/api/folder/download` endpoint.
    - `💾 Save to Account` — Batch saves all files across selected folders to your logged-in account via `/api/file/save`.
- **Virtual Merged Album View:**
  - Combines files from all selected folders into a unified `#filesGrid` on the current page.
  - Automatically loads and paginates through **all pages** (`1..totalPages`) for every chosen folder with live progress feedback.
  - Interactive top banner with clickable folder chips (`All files`, `📁 Folder A`, `📁 Folder B`) for instant single-folder filtering.
  - Direct origin badge (`📁 Folder Name`) injected into every file card.
  - One-click exit (`← Back to folders`) restores original files, subfolders section, and pagination without reloading.
- **Shareable `#merge=` URL Hashes:**
  - Deep-link support: opening an album with `#merge=slug1,slug2` automatically activates the merged view on startup.
- **Automated Tests:**
  - Unit tests in `test-standalone.cjs` covering folder metadata extraction (single and multi-page), sorting algorithms, and URL hash parsing.

### Changed
- Refactored folder card UI:
  - Removed duplicate size badge from thumbnail corner, keeping thumbnails clean and focused.
  - Consolidated all metadata under the folder title: `📄 X files (Y pages) · 💾 XX GB · 🕒 Date`.
  - Added checkbox and direct open button (`↗`) overlay on folder thumbnails.
- Upgraded folder metadata cache key to `v2` to invalidate legacy cached data.
- Updated documentation in `README.md` and `TIPS_AND_TRICKS_SK.md`.

---

## [2.0.0] - 2026-11-07

### Added
- **Initial Public Release of Filester Album Workspace (Standalone Edition):**
  - 100% client-side operation with zero localhost, Python, or companion server requirements.
  - 6 responsive 16:9 widescreen grid layouts (`Mini`, `Compact`, `Overview`, `Large`, `Cinema`, `Max`).
  - Advanced search query tokenizer with exact phrase matching (`"phrase"`) and negative exclusion (`-trailer -cam`).
  - Resolution tier filters (`4K`, `1440p`, `1080p`, `720p`, `SD`, `Unknown`).
  - Duration and file size range filters with live matching count.
  - 10 custom in-place sorting modes.
  - Direct browser metadata probing (native resolution, duration, upload date, direct CDN stream link).
  - Bitrate Density Scoring (`HQ`, `OK`, `LOW`).
  - In-page modal video player with `◀ Prev` / `Next ▶`, selection/review toggles, and direct URL copy.
  - Built-in Multi-Video Split-Screen Wall for up to 12 streams simultaneously.
  - Bulk exports: Copy Page URLs, Copy Direct URLs, Export `.M3U` playlist (VLC/MPV/IINA), Export `.JSON`.
  - Batch "Save to Account" integration via native Filester API.
  - Album state memory preserving "Load all pages" and exact scroll position on back/forward navigation.
  - Full keyboard shortcuts support (`/`, `Shift+A`, `Shift+I`, `Shift+C`, `Alt+Left/Right`, `Esc`, `?`).
  - Complete English localization.

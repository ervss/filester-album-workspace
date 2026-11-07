// ==UserScript==
// @name         Filester Album Workspace (Standalone Edition)
// @namespace    https://github.com/ervss/filester-album-workspace
// @version      2.0.0
// @description  Standalone power-user workspace for Filester albums & file manager: multi-size grid, advanced search, direct metadata probing, in-page video player, multi-video split-screen, review tracking, bulk export & save-to-account. No external server required!
// @author       ervss (https://github.com/ervss)
// @license      MIT
// @homepageURL  https://github.com/ervss/filester-album-workspace
// @supportURL   https://github.com/ervss/filester-album-workspace/issues
// @downloadURL  https://raw.githubusercontent.com/ervss/filester-album-workspace/main/filester-album-workspace-standalone.user.js
// @updateURL    https://raw.githubusercontent.com/ervss/filester-album-workspace/main/filester-album-workspace-standalone.user.js
// @match        https://filester.me/f/*
// @match        https://*.filester.me/f/*
// @match        https://filester.gg/f/*
// @match        https://*.filester.gg/f/*
// @match        https://filester.si/f/*
// @match        https://*.filester.si/f/*
// @match        https://filester.sh/f/*
// @match        https://*.filester.sh/f/*
// @match        https://filester.me/manager*
// @match        https://*.filester.me/manager*
// @match        https://filester.gg/manager*
// @match        https://*.filester.gg/manager*
// @match        https://filester.si/manager*
// @match        https://*.filester.si/manager*
// @match        https://filester.sh/manager*
// @match        https://*.filester.sh/manager*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      filester.me
// @connect      *.filester.me
// @connect      filester.gg
// @connect      *.filester.gg
// @connect      filester.si
// @connect      *.filester.si
// @connect      filester.sh
// @connect      *.filester.sh
// ==/UserScript==

(function () {
  'use strict';

  console.log(
    '%c[Filester Workspace v2.0.0 by ervss]%c Loaded — Album & File Manager Ready (https://github.com/ervss/filester-album-workspace)',
    'color: #35d07f; font-weight: bold',
    'color: #aaa'
  );

  // Global error handler for benign site script issues
  try {
    window.addEventListener('error', (event) => {
      if (event.filename?.includes('8377760840f21e5f') || event.message?.includes('addEventListener')) {
        console.warn('[Filester Workspace] Caught page error:', event.message, 'at', event.lineno);
        event.preventDefault();
      }
    });
  } catch (e) {
    console.warn('[Filester Workspace] Could not install global error handler:', e);
  }

  const PREFIX = 'filester-workspace-standalone';
  const LEGACY_PREFIX = 'nexus-filester-workspace';
  const TOOLBAR_ID = `${PREFIX}-toolbar`;
  const UTILITY_NAV_ID = `${PREFIX}-utility-nav`;
  const STYLE_ID = `${PREFIX}-styles`;
  const PREF_KEY = `${PREFIX}:prefs:v2`;
  const META_KEY = `${PREFIX}:meta:v2`;
  const META_CHUNK = 12;
  const STREAM_TTL_MS = 25 * 60 * 1000; // CDN tokens typically expire after ~30 mins

  const GRID_MODES = {
    mini: { label: 'Mini', min: 140, ratio: '16 / 9' },
    compact: { label: 'Compact', min: 185, ratio: '16 / 9' },
    overview: { label: 'Overview', min: 220, ratio: '16 / 9' },
    large: { label: 'Large', min: 340, ratio: '16 / 9' },
    cinema: { label: 'Cinema', min: 460, ratio: '16 / 9' },
    poster: { label: 'Max', min: 560, ratio: '16 / 9' },
  };

  const GM_REQ = typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest
    : (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest.bind(GM) : null;

  let grid = null;
  let items = [];
  let refreshTimer = null;
  let metadataRunning = false;
  let toastTimer = null;
  let bootAttempts = 0;
  let managerLoading = false;
  let playerModal = null;
  let splitModal = null;
  let shortcutsModal = null;
  let lastSelectedIndex = -1;
  let currentPlayerIndex = -1;

  const metadata = Object.assign(loadObject(`${LEGACY_PREFIX}:meta:v1`), loadObject(META_KEY));
  const state = Object.assign({
    layout: 'large',
    query: '',
    quality: 'all',
    sort: 'native',
    minDuration: '',
    maxDuration: '',
    minSize: '',
    maxSize: '',
    hideMisses: true,
    onlyUnreviewed: false,
    onlySelected: false,
  }, loadObject(PREF_KEY));

  const selected = new Set([
    ...loadArray(legacyAlbumStorageKey('selected')),
    ...loadArray(albumStorageKey('selected')),
  ]);
  const reviewed = new Set([
    ...loadArray(legacyAlbumStorageKey('reviewed')),
    ...loadArray(albumStorageKey('reviewed')),
  ]);

  // Initialize
  try {
    injectStyles();
    initAlbumStateMemory();
    if (document.readyState === 'loading') {
      if (document.addEventListener) {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
      } else {
        window.setTimeout(boot, 100);
      }
    } else {
      boot();
    }
  } catch (error) {
    console.error('[Filester Workspace] Fatal initialization error:', error);
  }

  function boot() {
    try {
      grid = findFileGrid();
      if (isManagerPage() && !grid) {
        if (!managerLoading) loadManagerGrid();
        return;
      }
      if (!grid) {
        bootAttempts += 1;
        if (bootAttempts >= 30) {
          console.warn('[Filester Workspace] File cards were not found; stopping initialization.');
          return;
        }
        if (bootAttempts === 1) console.log('[Filester Workspace] Waiting for Filester file cards...');
        window.setTimeout(boot, 1000);
        return;
      }
      bootAttempts = 0;

      console.log('[Filester Workspace] Grid found, initializing...');
      ensureToolbar();
      compactAlbumHeader();
      refresh();
      observeGrid();
      bindKeyboardShortcuts();
      console.log('[Filester Workspace] Initialization complete');
    } catch (error) {
      console.error('[Filester Workspace] Error during boot:', error);
      window.setTimeout(boot, 2000);
    }
  }

  // --- Album state memory: "Load all pages" + scroll position restore --------
  // When opening a video page and navigating back, the album normally resets.
  // We remember if all pages were loaded and restore scroll position automatically.
  function initAlbumStateMemory() {
    if (!/^\/f\//i.test(location.pathname)) return;
    const key = `${PREFIX}:albumstate:${location.origin}${location.pathname}${location.search}`;
    const TTL = 6 * 60 * 60 * 1000;
    const read = () => {
      try {
        const s = JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || 'null');
        return s && Date.now() - (s.ts || 0) < TTL ? s : null;
      } catch { return null; }
    };
    const write = (patch) => {
      const next = Object.assign({ loadedAll: false, scrollY: 0 }, read() || {}, patch, { ts: Date.now() });
      try {
        const raw = JSON.stringify(next);
        sessionStorage.setItem(key, raw);
        localStorage.setItem(key, raw);
      } catch { /* ignore */ }
    };
    const saved = read();
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const isBack = nav?.type === 'back_forward';
    const wantAll = !!saved?.loadedAll;
    let wantScroll = isBack && saved?.scrollY > 0 ? saved.scrollY : 0;
    let tracking = false;
    let clicked = 0;

    const loadedAllDone = () => /Loaded all\s+\d+\s+pages/i.test(document.body.innerText || '');
    const findLoadAllButton = () => [...document.querySelectorAll('button, a, [role="button"]')]
      .find((el) => /^\s*load all( pages)?\s*$/i.test(el.textContent || '') && !el.disabled);

    const finishRestore = () => {
      if (wantScroll) {
        const y = wantScroll;
        wantScroll = 0;
        window.scrollTo(0, y);
        window.setTimeout(() => window.scrollTo(0, y), 300);
      }
      tracking = true;
    };

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const done = loadedAllDone();
      if (done) {
        write({ loadedAll: true });
        window.clearInterval(timer);
        finishRestore();
        return;
      }
      if (wantAll) {
        const btn = findLoadAllButton();
        if (btn && Date.now() - clicked > 4000) {
          clicked = Date.now();
          btn.click();
        }
      }
      if (Date.now() - startedAt > 90000) {
        window.clearInterval(timer);
        finishRestore();
      }
    }, 400);
    if (!wantAll) window.setTimeout(() => { tracking = true; }, 1500);

    document.addEventListener('click', (event) => {
      const el = event.target.closest?.('button, a, [role="button"]');
      if (el && /load all/i.test(el.textContent || '')) write({ loadedAll: true });
    }, true);

    const saveScroll = () => { if (tracking) write({ scrollY: window.scrollY }); };
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(saveScroll, 150);
    }, { passive: true });
    window.addEventListener('pagehide', saveScroll);
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('a[href*="/d/"]')) {
        tracking = true;
        saveScroll();
      }
    }, true);
  }

  function isManagerPage() {
    return /^\/manager\/?$/i.test(location.pathname);
  }

  function findFileGrid() {
    const known = document.querySelector('#filesGrid, .files-list.grid-view, .files-list');
    if (known) return known;
    const card = document.querySelector('.file-item, .file-card, [data-file-id], a[href*="/d/"]');
    if (!card) return null;
    let candidate = card.closest('.file-list, .file-grid, .grid, section, main');
    for (let level = 0; level < 4 && card.parentElement; level += 1) {
      const parent = level === 0 ? card.parentElement : candidate?.parentElement;
      if (!parent) break;
      const links = parent.querySelectorAll('a[href*="/d/"]');
      if (links.length >= 2) candidate = parent;
    }
    return candidate || card.parentElement;
  }

  async function loadManagerGrid() {
    managerLoading = true;
    try {
      const params = new URLSearchParams({
        files_page: '1', folders_page: '1', with_hierarchy: '1',
        folder_sort: 'newest', _t: String(Date.now()),
      });
      const response = await fetch(`/api/manager/data?${params}`, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) throw new Error(`Manager API HTTP ${response.status}`);
      const data = await response.json();
      const files = Array.isArray(data.files) ? data.files : [];
      const host = document.querySelector('main, .main-content, #app') || document.body;
      const managerGrid = document.createElement('div');
      managerGrid.className = 'nfw-manager-grid';
      managerGrid.innerHTML = files.map((file) => {
        const slug = String(file.Slug || file.slug || '').trim();
        const title = String(file.OriginalName || file.name || file.Name || slug || 'Unnamed').trim();
        if (!slug) return '';
        const thumbnail = String(file.ThumbnailURL || file.thumbnail || '').trim();
        const size = Number(file.Size || file.size || 0) || 0;
        const fileUrl = `/d/${encodeURIComponent(slug)}`;
        const image = thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy">` : '';
        const fileType = String(file.Type || file.type || file.MimeType || file.mime_type || '').toLowerCase();
        const isVideo = /video|\.(mp4|mkv|webm|mov|avi|m4v|ts)$/i.test(`${fileType} ${title}`);
        const uploadedAt = file.CreatedAt || file.created_at || file.UploadedAt || file.uploaded_at || file.UploadDate || file.upload_date || '';
        return `<article class="file-item nfw-manager-item" data-name="${escapeHtml(title)}" data-url="${fileUrl}" data-slug="${escapeHtml(slug)}" data-type="${isVideo ? 'videos' : ''}" data-size="${size}" data-date="${escapeHtml(uploadedAt)}"><a href="${fileUrl}"><div class="file-preview">${image}</div><span class="file-name">${escapeHtml(title)}</span></a></article>`;
      }).join('');
      host.appendChild(managerGrid);
      grid = managerGrid;
      managerLoading = false;
      boot();
    } catch (error) {
      managerLoading = false;
      console.warn('[Filester Workspace] Manager API unavailable:', error.message || error);
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  function fileCards(container) {
    const direct = [...container.querySelectorAll(':scope > .file-item, :scope > .file-card, :scope > [data-file-id]')];
    if (direct.length) return direct;
    const unique = new Set();
    return [...container.querySelectorAll('a[href*="/d/"]')].map((anchor) => {
      return anchor.closest('.file-item, .file-card, [data-file-id], article') || anchor.parentElement;
    }).filter((card) => card && !unique.has(card) && unique.add(card));
  }

  function albumStorageKey(kind) {
    return `${PREFIX}:${kind}:${location.origin}${location.pathname}`;
  }

  function legacyAlbumStorageKey(kind) {
    return `${LEGACY_PREFIX}:${kind}:${location.origin}${location.pathname}`;
  }

  function loadObject(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
    catch { return {}; }
  }

  function loadArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function persist() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(state));
      localStorage.setItem(META_KEY, JSON.stringify(trimMetadata(metadata, 5000)));
      localStorage.setItem(albumStorageKey('selected'), JSON.stringify([...selected]));
      localStorage.setItem(albumStorageKey('reviewed'), JSON.stringify([...reviewed]));
    } catch (error) {
      console.warn('[Filester Workspace] Preferences could not be saved.', error);
    }
  }

  function trimMetadata(cache, limit) {
    const entries = Object.entries(cache);
    if (entries.length <= limit) return cache;
    entries.sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0));
    return Object.fromEntries(entries.slice(0, limit));
  }

  function observeGrid() {
    if (!grid) return;

    try {
      new MutationObserver((mutations) => {
        const onlyWorkspaceMoves = mutations.length > 0 && mutations.every((mutation) => {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          return nodes.length > 0 && nodes.every((node) => (
            node.nodeType === Node.ELEMENT_NODE && node.classList.contains('nfw-card')
          ));
        });
        if (!onlyWorkspaceMoves) scheduleRefresh();
      }).observe(grid, { childList: true });
    } catch (error) {
      console.warn('[Filester Workspace] Failed to observe grid:', error);
    }

    const sortSelect = document.querySelector('#sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        for (const card of fileCards(grid)) delete card.dataset.nfwOriginalIndex;
        scheduleRefresh();
      });
    }

    const folderSearch = document.querySelector('#folderSearch');
    if (folderSearch) {
      folderSearch.addEventListener('input', scheduleRefresh);
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 180);
  }

  function refresh() {
    try {
      grid = findFileGrid() || grid;
      if (!grid) return;
      items = fileCards(grid).map(readCard).filter(Boolean);
      injectCardTools();
      applyLayout();
      applySortAndFilters();
      syncToolbar();
    } catch (error) {
      console.error('[Filester Workspace] Error during refresh:', error);
    }
  }

  function readCard(el, index) {
    const title = (el.dataset.name || el.dataset.filename || el.querySelector('.file-name, .filename, [data-file-name]')?.textContent || '').trim();
    const onclick = el.getAttribute('onclick') || '';
    const rawUrl = el.dataset.url || el.dataset.fileUrl || el.dataset.href || el.querySelector('a[href*="/d/"]')?.href || '';
    const slug = onclick.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1]
      || rawUrl.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1]
      || el.dataset.slug || el.dataset.fileId;
    if (!title || !slug) return null;
    const url = rawUrl.includes('/d/') ? new URL(rawUrl, location.origin).href : new URL(`/d/${slug}`, location.origin).href;
    const thumb = el.querySelector('.file-preview img, img')?.src || '';
    const sizeText = el.dataset.size || el.getAttribute('data-size') || el.querySelector('.file-size, .size')?.textContent || 0;
    const sizeBytes = parseSizeBytes(sizeText);
    const dateTs = parseUploadTime(el.dataset.date || el.dataset.uploadedAt || el.dataset.createdAt || el.querySelector('time[datetime]')?.dateTime || '');
    const type = (el.dataset.type || el.dataset.fileType || (title.match(/\.(mp4|mkv|webm|mov|avi|m4v|ts)$/i) ? 'videos' : '')).toLowerCase();
    if (el.dataset.nfwOriginalIndex == null) el.dataset.nfwOriginalIndex = String(index);
    const originalIndex = Number(el.dataset.nfwOriginalIndex);
    const meta = metadata[url] || {};
    const guessedHeight = guessHeight(title);
    return { el, index: originalIndex, title, slug, url, thumb, sizeBytes, dateTs, type, meta, guessedHeight };
  }

  function toggleItemSelection(item, forceState, shiftKey = false) {
    const currentList = sortedItems(visibleItems());
    const currentIndex = currentList.findIndex((candidate) => candidate.url === item.url);
    const nextState = forceState != null ? forceState : !selected.has(item.url);

    if (shiftKey && lastSelectedIndex >= 0 && currentIndex >= 0) {
      const start = Math.min(lastSelectedIndex, currentIndex);
      const end = Math.max(lastSelectedIndex, currentIndex);
      for (let i = start; i <= end; i += 1) {
        const target = currentList[i];
        if (!target) continue;
        nextState ? selected.add(target.url) : selected.delete(target.url);
        const cb = target.el.querySelector('.nfw-check');
        if (cb) cb.checked = nextState;
        target.el.classList.toggle('nfw-selected', nextState);
      }
    } else {
      nextState ? selected.add(item.url) : selected.delete(item.url);
      const cb = item.el.querySelector('.nfw-check');
      if (cb) cb.checked = nextState;
      item.el.classList.toggle('nfw-selected', nextState);
    }

    if (currentIndex >= 0) lastSelectedIndex = currentIndex;
    persist();
    if (state.onlySelected) applySortAndFilters();
    syncToolbar();
  }

  function injectCardTools() {
    for (const item of items) {
      const { el, url } = item;
      el.classList.add('nfw-card');
      let checkbox = el.querySelector('.nfw-check');
      if (!checkbox) {
        const label = document.createElement('label');
        label.className = 'nfw-check-wrap';
        label.title = 'Select for bulk action (Shift+Click for range)';
        label.innerHTML = '<input class="nfw-check" type="checkbox"><span></span>';
        stopCardClick(label);
        el.appendChild(label);
        checkbox = label.querySelector('input');
        label.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleItemSelection(item, !checkbox.checked, event.shiftKey);
        });
      }
      checkbox.checked = selected.has(url);
      el.classList.toggle('nfw-selected', checkbox.checked);

      let review = el.querySelector('.nfw-review');
      if (!review) {
        review = document.createElement('button');
        review.type = 'button';
        review.className = 'nfw-review';
        stopCardClick(review);
        review.addEventListener('click', () => {
          reviewed.has(url) ? reviewed.delete(url) : reviewed.add(url);
          persist();
          refresh();
        });
        el.appendChild(review);
      }
      const done = reviewed.has(url);
      review.textContent = done ? '✓' : '○';
      review.title = done ? 'Marked as reviewed – click to undo' : 'Mark as reviewed';
      el.classList.toggle('nfw-reviewed', done);

      let badge = el.querySelector('.nfw-meta-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'nfw-meta-badge';
        el.appendChild(badge);
      }
      paintBadge(item, badge);

      const preview = el.querySelector('.file-preview');
      if (preview && !preview.dataset.nfwSelectBound) {
        preview.dataset.nfwSelectBound = '1';
        preview.classList.add('nfw-select-preview');
        preview.title = 'Click to select video · Shift+Click to select range';
        preview.addEventListener('click', (event) => {
          if (event.target.closest('.nfw-play, .nfw-split-play')) return;
          event.preventDefault();
          event.stopPropagation();
          const currentItem = items.find((c) => c.el === el) || item;
          toggleItemSelection(currentItem, !selected.has(currentItem.url), event.shiftKey);
        }, true);
      }

      let play = el.querySelector('.nfw-play');
      if (item.type === 'videos' && !play) {
        play = document.createElement('button');
        play.type = 'button';
        play.className = 'nfw-play';
        play.title = 'Play video in modal player';
        play.setAttribute('aria-label', `Play ${item.title}`);
        play.textContent = '▶';
        stopCardClick(play);
        play.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const currentItem = items.find((c) => c.el === el) || item;
          openPlayer(currentItem);
        });
        (preview || el).appendChild(play);
      }
      if (play) {
        play.hidden = item.type !== 'videos';
      }

      let splitPlay = el.querySelector('.nfw-split-play');
      if (item.type === 'videos' && !splitPlay) {
        splitPlay = document.createElement('button');
        splitPlay.type = 'button';
        splitPlay.className = 'nfw-split-play';
        splitPlay.title = 'Open in Multi-Video Split-Screen';
        splitPlay.setAttribute('aria-label', `Open ${item.title} in Split-Screen`);
        splitPlay.textContent = '▦';
        stopCardClick(splitPlay);
        splitPlay.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const currentItem = items.find((c) => c.el === el) || item;
          openInSplitScreen(currentItem, splitPlay);
        });
        (preview || el).appendChild(splitPlay);
      }
      if (splitPlay) splitPlay.hidden = item.type !== 'videos';
    }
  }

  // --- Direct Standalone Metadata & Stream Resolver (No Server Needed!) -----
  function parseDurationString(text) {
    if (!text) return 0;
    const parts = String(text).trim().split(':').map((p) => Number.parseInt(p, 10));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return 0;
  }

  function scrapeFilesterFileHtml(html, pageUrl) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const result = {
      title: '',
      thumbnail: '',
      duration: 0,
      sizeBytes: 0,
      width: 0,
      height: 0,
      upload_date: '',
      stream_url: '',
    };

    // Title
    const rawTitle = doc.querySelector('title')?.textContent || '';
    if (rawTitle) {
      result.title = rawTitle.split(/\s*[|\-]\s*filester/i)[0].trim();
    }
    if (!result.title) {
      const ogTitle = doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute('content') || '';
      if (ogTitle) result.title = ogTitle.split(/\s*[|\-]\s*filester/i)[0].trim();
    }
    result.title = result.title.replace(/\.(mp4|mkv|webm|avi|mov|m4v|ts)$/i, '').trim();

    // Quality hint from trailing (1080) or filename
    const qm = result.title.match(/\((\d{3,4})\)\s*$/);
    const hintHeight = qm ? Number(qm[1]) : 0;
    const guessedH = guessHeight(result.title) || hintHeight;
    if (guessedH) {
      result.height = guessedH;
      result.width = { 2160: 3840, 1440: 2560, 1080: 1920, 720: 1280, 480: 854, 360: 640 }[guessedH] || 0;
    }

    // Thumbnail
    let thumb = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
    if (!thumb) {
      thumb = doc.querySelector('video[poster]')?.getAttribute('poster')?.trim() || '';
    }
    if (thumb.startsWith('//')) thumb = `https:${thumb}`;
    else if (thumb.startsWith('/')) thumb = `${location.origin}${thumb}`;
    result.thumbnail = thumb;

    // Upload date
    const dateTag = doc.querySelector('meta[property="article:published_time"], meta[property="video:release_date"], meta[itemprop="uploadDate"], meta[itemprop="datePublished"], time[datetime], [data-uploaded-at], [data-created-at], [data-upload-date]');
    if (dateTag) {
      result.upload_date = dateTag.getAttribute('content') || dateTag.getAttribute('datetime') || dateTag.getAttribute('data-uploaded-at') || dateTag.getAttribute('data-created-at') || dateTag.getAttribute('data-upload-date') || '';
    }

    // Duration
    const vidEl = doc.querySelector('video[data-duration]');
    if (vidEl) {
      const d = Number.parseFloat(vidEl.getAttribute('data-duration'));
      if (d > 0) result.duration = d;
    }
    if (!result.duration) {
      const ogDur = Number.parseFloat(doc.querySelector('meta[property="og:video:duration"]')?.getAttribute('content') || '0');
      if (ogDur > 0) result.duration = ogDur;
    }
    if (!result.duration) {
      for (const attr of ['data-duration', 'data-length', 'data-time']) {
        const el = doc.querySelector(`[${attr}]`);
        if (el) {
          const d = Number.parseFloat(el.getAttribute(attr));
          if (d > 0) { result.duration = d; break; }
        }
      }
    }
    if (!result.duration) {
      const scripts = [...doc.querySelectorAll('script')].map((s) => s.textContent || '').join('\n');
      const dm = scripts.match(/"duration"\s*:\s*(\d+(?:\.\d+)?)/) || scripts.match(/\bduration\s*[:=]\s*(\d+(?:\.\d+)?)/);
      if (dm) {
        const d = Number.parseFloat(dm[1]);
        if (d > 1 && d < 86400) result.duration = d;
      }
    }

    // Size
    const bodyText = doc.body?.textContent || '';
    const sizeMatch = bodyText.match(/([\d.]+)\s*(TB|GB|MB|KB)\b/i);
    if (sizeMatch) {
      result.sizeBytes = parseSizeBytes(sizeMatch[0]);
    }

    // Fallback stream URL from HTML
    for (const sel of ['video source[src]', 'video[src]', 'source[src]']) {
      const src = doc.querySelector(sel)?.getAttribute('src')?.trim() || '';
      if (src && !src.startsWith('blob:')) {
        result.stream_url = src.startsWith('//') ? `https:${src}` : new URL(src, pageUrl).href;
        break;
      }
    }
    if (!result.stream_url) {
      const m = String(html || '').match(/(https?:\/\/(?:cache\d*\.filester\.[a-z]+|cdn\d*\.[^"'\s<>]+)\/[^"'\s<>]+\.(?:mp4|mkv|webm)(?:\?[^"'\s<>]*)?)/i);
      if (m) result.stream_url = m[1];
    }

    return result;
  }

  async function resolveDirectFilesterItem(item, { forceFreshStream = false, probeVideo = false } = {}) {
    const cached = metadata[item.url] || {};
    const age = Date.now() - Number(cached.ts || 0);
    const cachedStream = String(cached.stream_url || cached.direct_url || '').trim();
    if (!forceFreshStream && cachedStream && age < STREAM_TTL_MS && Number(cached.duration) > 0) {
      return cached;
    }

    const slug = item.slug || item.url.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] || '';
    if (!slug) throw new Error('Invalid Filester file slug.');

    let streamUrl = (!forceFreshStream && age < STREAM_TTL_MS) ? cachedStream : '';
    let apiData = {};

    // 1. Call Filester public view API directly from the browser
    try {
      const viewResp = await bridgeFetch(`${location.origin}/v2/api/public/view`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify({ file_slug: slug }),
        timeoutMs: 15000,
      });
      if (viewResp.ok) {
        apiData = await viewResp.json().catch(() => ({}));
        const apiServer = String(apiData.server || '').trim().replace(/\/$/, '');
        const apiFile = String(apiData.file || '').trim().replace(/^\//, '');
        const token = String(apiData.token || '').trim();
        const viewUrl = String(apiData.view_url || apiData.url || apiData.stream_url || '').trim();
        if (/^https?:\/\//i.test(apiServer) && apiFile && token) {
          streamUrl = `${apiServer}/v2/${apiFile}?token=${token}`;
        } else if (viewUrl) {
          streamUrl = viewUrl.startsWith('http') ? viewUrl : `https://cache1.${location.hostname.replace(/^www\./, '')}${viewUrl}`;
        }
      }
    } catch (err) {
      console.warn('[Filester Workspace] Public view API warning:', err);
    }

    // 2. Scrape the /d/<slug> HTML page for duration, size, upload_date, thumbnail, or fallback stream
    let pageMeta = {};
    try {
      const pageResp = await bridgeFetch(item.url, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        timeoutMs: 15000,
      });
      if (pageResp.ok) {
        const html = await pageResp.text();
        pageMeta = scrapeFilesterFileHtml(html, item.url);
        if (!streamUrl && pageMeta.stream_url) {
          streamUrl = pageMeta.stream_url;
        }
      }
    } catch (err) {
      console.warn('[Filester Workspace] File page scrape warning:', err);
    }

    const apiDur = Number(apiData.duration || apiData.duration_seconds || apiData.length || apiData.video_duration || 0);
    let duration = apiDur || Number(pageMeta.duration || cached.duration || 0);
    let height = Number(apiData.height || pageMeta.height || cached.height || item.guessedHeight || 0);
    let width = Number(apiData.width || pageMeta.width || cached.width || 0);

    // 3. Optional HTML5 <video> probe if duration or resolution is still missing
    if (probeVideo && streamUrl && (!duration || !height)) {
      const probed = await probeVideoMetadata(streamUrl);
      if (probed.duration > 0) duration = probed.duration;
      if (probed.height > 0) height = probed.height;
      if (probed.width > 0) width = probed.width;
    }

    const sizeBytes = parseSizeBytes(apiData.size || apiData.size_bytes || pageMeta.sizeBytes || cached.sizeBytes || item.sizeBytes || 0);
    const uploadDate = apiData.created_at || apiData.uploaded_at || apiData.upload_date || pageMeta.upload_date || cached.upload_date || '';
    const thumbnail = normalizeThumbnailUrl(apiData.thumbnail || apiData.thumbnail_url || pageMeta.thumbnail || cached.thumbnail || item.thumb || '');

    const nextMeta = {
      ok: Boolean(streamUrl || duration || sizeBytes),
      duration: Number(duration || 0),
      height: Number(height || 0),
      width: Number(width || 0),
      quality: height ? qualityLabel(height) : (cached.quality || ''),
      sizeBytes,
      thumbnail,
      stream_url: streamUrl,
      direct_url: streamUrl,
      upload_date: uploadDate,
      ts: Date.now(),
    };

    metadata[item.url] = nextMeta;
    persist();
    return nextMeta;
  }

  async function resolvePlayerStream(item, forceFresh = false) {
    const meta = await resolveDirectFilesterItem(item, { forceFreshStream: forceFresh, probeVideo: false });
    const stream = String(meta.stream_url || meta.direct_url || '').trim();
    if (!stream) throw new Error('Could not resolve direct video stream for this file.');
    return stream;
  }

  function normalizeThumbnailUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, location.origin);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  // --- Built-in Modal Video Player -------------------------------------------
  function ensurePlayerModal() {
    if (playerModal) return playerModal;
    playerModal = document.createElement('div');
    playerModal.id = `${PREFIX}-player`;
    playerModal.className = 'nfw-player-modal';
    playerModal.hidden = true;
    playerModal.innerHTML = `
      <section class="nfw-player-dialog" role="dialog" aria-modal="true" aria-label="Video Player">
        <header>
          <strong data-role="title"></strong>
          <div class="nfw-player-controls">
            <button type="button" data-action="prev" title="Previous video (←)">◀ Prev</button>
            <button type="button" data-action="next" title="Next video (→)">Next ▶</button>
            <button type="button" data-action="toggleSelect" title="Select / Deselect video">☐ Select</button>
            <button type="button" data-action="toggleReview" title="Mark as reviewed">○ Review</button>
            <button type="button" data-action="copyStream" title="Copy direct stream URL">Copy Stream</button>
            <button type="button" data-action="close" aria-label="Close player">×</button>
          </div>
        </header>
        <div class="nfw-player-stage" data-role="stage"><p>Loading video player…</p></div>
      </section>`;
    document.body.appendChild(playerModal);

    playerModal.querySelector('[data-action="close"]').addEventListener('click', closePlayer);
    playerModal.querySelector('[data-action="prev"]').addEventListener('click', () => stepPlayer(-1));
    playerModal.querySelector('[data-action="next"]').addEventListener('click', () => stepPlayer(1));
    playerModal.querySelector('[data-action="toggleSelect"]').addEventListener('click', () => {
      const item = currentModalItem();
      if (!item) return;
      toggleItemSelection(item);
      syncPlayerHeader(item);
    });
    playerModal.querySelector('[data-action="toggleReview"]').addEventListener('click', () => {
      const item = currentModalItem();
      if (!item) return;
      reviewed.has(item.url) ? reviewed.delete(item.url) : reviewed.add(item.url);
      persist();
      refresh();
      syncPlayerHeader(item);
    });
    playerModal.querySelector('[data-action="copyStream"]').addEventListener('click', async () => {
      const item = currentModalItem();
      if (!item) return;
      const stream = metadata[item.url]?.stream_url || '';
      if (!stream) { toast('Stream URL not ready yet.', true); return; }
      await copyTextToClipboard(stream);
      toast('Direct stream URL copied to clipboard!');
    });

    playerModal.addEventListener('click', (event) => {
      if (event.target === playerModal) closePlayer();
    });
    document.addEventListener('keydown', (event) => {
      if (!playerModal || playerModal.hidden) return;
      if (event.key === 'Escape') closePlayer();
      else if (event.key === 'ArrowLeft' && event.altKey) { event.preventDefault(); stepPlayer(-1); }
      else if (event.key === 'ArrowRight' && event.altKey) { event.preventDefault(); stepPlayer(1); }
    });
    return playerModal;
  }

  function currentModalItem() {
    const list = playableVisibleVideos();
    return list[currentPlayerIndex] || null;
  }

  function playableVisibleVideos() {
    return sortedItems(visibleItems()).filter((item) => item.type === 'videos');
  }

  function stepPlayer(delta) {
    const list = playableVisibleVideos();
    if (!list.length) return;
    currentPlayerIndex = (currentPlayerIndex + delta + list.length) % list.length;
    openPlayer(list[currentPlayerIndex]);
  }

  function syncPlayerHeader(item) {
    if (!playerModal || !item) return;
    const selBtn = playerModal.querySelector('[data-action="toggleSelect"]');
    const revBtn = playerModal.querySelector('[data-action="toggleReview"]');
    if (selBtn) {
      const isSel = selected.has(item.url);
      selBtn.textContent = isSel ? '☑ Selected' : '☐ Select';
      selBtn.classList.toggle('is-on', isSel);
    }
    if (revBtn) {
      const isRev = reviewed.has(item.url);
      revBtn.textContent = isRev ? '✓ Reviewed' : '○ Review';
      revBtn.classList.toggle('is-on', isRev);
    }
  }

  function closePlayer() {
    if (!playerModal) return;
    const video = playerModal.querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    playerModal.hidden = true;
  }

  async function openPlayer(item) {
    const modal = ensurePlayerModal();
    const list = playableVisibleVideos();
    const idx = list.findIndex((c) => c.url === item.url);
    if (idx >= 0) currentPlayerIndex = idx;

    const title = modal.querySelector('[data-role="title"]');
    const stage = modal.querySelector('[data-role="stage"]');
    title.textContent = item.title;
    syncPlayerHeader(item);
    stage.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Resolving direct stream…' }));
    modal.hidden = false;

    try {
      const stream = await resolvePlayerStream(item);
      const video = document.createElement('video');
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = stream;
      video.addEventListener('loadedmetadata', () => {
        const cur = metadata[item.url] || {};
        if (video.duration > 0 || video.videoHeight > 0) {
          metadata[item.url] = Object.assign({}, cur, {
            duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : cur.duration,
            height: video.videoHeight || cur.height || 0,
            width: video.videoWidth || cur.width || 0,
            ts: Date.now(),
          });
          persist();
          refresh();
        }
      });
      video.addEventListener('error', async () => {
        if (!video.dataset.retried) {
          video.dataset.retried = '1';
          try {
            const fresh = await resolvePlayerStream(item, true);
            video.src = fresh;
            video.load();
            await video.play().catch(() => {});
            return;
          } catch { /* fall through */ }
        }
        stage.querySelector('.nfw-player-error')?.remove();
        const message = document.createElement('p');
        message.className = 'nfw-player-error';
        message.textContent = 'The video player could not load this stream.';
        stage.appendChild(message);
      });
      stage.replaceChildren(video);
      try {
        await video.play();
      } catch (_) {
        video.muted = true;
        await video.play().catch(() => {});
      }
      refresh();
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'nfw-player-error';
      message.textContent = error.message || 'Could not open video player.';
      stage.replaceChildren(message);
    }
  }

  // --- Built-in Standalone Multi-Video Split-Screen Player ------------------
  function ensureSplitModal() {
    if (splitModal) return splitModal;
    splitModal = document.createElement('div');
    splitModal.id = `${PREFIX}-split-modal`;
    splitModal.className = 'nfw-split-modal';
    splitModal.hidden = true;
    splitModal.innerHTML = `
      <header class="nfw-split-bar">
        <strong>▦ Multi-Video Split-Screen</strong>
        <span data-role="count"></span>
        <div class="nfw-split-actions">
          <button type="button" data-split-action="playAll">▶ Play All</button>
          <button type="button" data-split-action="pauseAll">⏸ Pause All</button>
          <button type="button" data-split-action="muteAll">🔇 Mute All</button>
          <button type="button" data-split-action="close">× Close (Esc)</button>
        </div>
      </header>
      <div class="nfw-split-grid" data-role="grid"></div>`;
    document.body.appendChild(splitModal);

    splitModal.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-split-action]');
      if (!btn) return;
      const action = btn.dataset.splitAction;
      const videos = [...splitModal.querySelectorAll('video')];
      if (action === 'playAll') videos.forEach((v) => v.play().catch(() => {}));
      if (action === 'pauseAll') videos.forEach((v) => v.pause());
      if (action === 'muteAll') videos.forEach((v) => { v.muted = true; });
      if (action === 'close') closeSplitModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && splitModal && !splitModal.hidden) closeSplitModal();
    });

    return splitModal;
  }

  function closeSplitModal() {
    if (!splitModal) return;
    for (const v of splitModal.querySelectorAll('video')) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    splitModal.hidden = true;
  }

  async function openInSplitScreen(item, button) {
    return openSelectedInSplitScreen([item], button);
  }

  async function openSelectedInSplitScreen(targets, button) {
    if (!targets.length) { toast('Select at least one video for Split-Screen first.', true); return; }
    if (targets.length > 12) { toast('Split-Screen supports up to 12 videos at once. Please refine your selection.', true); return; }
    if (button) button.disabled = true;
    const label = button ? button.textContent : '';
    let finished = 0;

    try {
      const resolved = await mapWithLimit(targets, 3, async (item) => {
        try {
          const stream = await resolvePlayerStream(item);
          const meta = metadata[item.url] || {};
          return {
            url: stream,
            directUrl: stream,
            watchUrl: item.url,
            title: item.title,
            poster: meta.thumbnail || item.thumb || '',
            duration: Number(meta.duration) || 0,
            quality: meta.quality || (meta.height ? `${meta.height}p` : ''),
            size: Number(meta.sizeBytes || item.sizeBytes) || 0,
          };
        } catch (error) {
          console.warn('[Filester Workspace] Split-Screen error:', item.url, error);
          return null;
        } finally {
          finished += 1;
          if (button) button.textContent = `Loading ${finished}/${targets.length}`;
        }
      });

      const playable = resolved.filter(Boolean);
      if (!playable.length) throw new Error('Could not load any of the selected videos.');

      // If external Universal Split-Screen userscript is installed, support it seamlessly;
      // otherwise open our built-in standalone Split-Screen wall!
      if (document.documentElement.dataset.nexusSplitReady === '1') {
        document.dispatchEvent(new CustomEvent('nexus-filester-split-open', {
          detail: JSON.stringify(playable),
        }));
      } else {
        launchBuiltInSplitScreen(playable);
      }

      if (playable.length < targets.length) {
        toast(`Loaded ${playable.length}/${targets.length} videos; some streams were unavailable.`, true);
      }
      refresh();
    } catch (error) {
      toast(`Split-Screen failed: ${error.message || error}`, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  function launchBuiltInSplitScreen(playable) {
    const modal = ensureSplitModal();
    const gridEl = modal.querySelector('[data-role="grid"]');
    const countEl = modal.querySelector('[data-role="count"]');
    countEl.textContent = `${playable.length} video${playable.length === 1 ? '' : 's'} · Hover a tile to unmute`;

    const cols = playable.length <= 1 ? 1 : playable.length <= 4 ? 2 : playable.length <= 9 ? 3 : 4;
    gridEl.style.setProperty('--nfw-split-cols', String(cols));
    gridEl.innerHTML = '';

    playable.forEach((entry) => {
      const cell = document.createElement('div');
      cell.className = 'nfw-split-cell';
      cell.innerHTML = `
        <div class="nfw-split-cell-head">
          <span title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</span>
          <a href="${escapeHtml(entry.watchUrl)}" target="_blank" rel="noopener" title="Open file page">↗</a>
        </div>
        <video controls autoplay muted loop playsinline preload="metadata" poster="${escapeHtml(entry.poster || '')}" src="${escapeHtml(entry.url)}"></video>`;
      const video = cell.querySelector('video');
      cell.addEventListener('mouseenter', () => {
        for (const other of gridEl.querySelectorAll('video')) {
          other.muted = other !== video;
        }
      });
      gridEl.appendChild(cell);
      video.play().catch(() => {});
    });

    modal.hidden = false;
  }

  function stopCardClick(element) {
    if (!element) return;
    for (const name of ['pointerdown', 'mousedown', 'click', 'dblclick']) {
      element.addEventListener(name, (event) => event.stopPropagation());
    }
  }

  function paintBadge(item, badge) {
    const meta = metadata[item.url] || {};
    const height = Number(meta.height || 0) || item.guessedHeight;
    const duration = Number(meta.duration || 0);
    const size = parseSizeBytes(meta.sizeBytes || meta.size_bytes || meta.file_size_mb || 0) || item.sizeBytes;
    const bitrate = duration && size ? (size * 8) / duration : 0;
    const score = densityScore(height, bitrate);
    const parts = [];
    if (duration) parts.push(`<span>⏱ ${formatDuration(duration)}</span>`);
    if (height) parts.push(`<span>${qualityLabel(height)}${meta.height ? '' : '*'}</span>`);
    if ( size && !duration ) parts.push(`<span>💾 ${formatSize(size)}</span>`);
    if (score.label) parts.push(`<span class="${score.cls}" title="${score.title}">${score.label} ${formatBitrate(bitrate)}</span>`);
    const uploadTs = parseUploadTime(meta.upload_date) || item.dateTs;
    if (uploadTs) {
      const full = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(uploadTs);
      parts.push(`<span class="nfw-upload-date" title="Uploaded: ${full}">📅 ${full}</span>`);
    }
    badge.innerHTML = parts.join('');
    badge.hidden = !parts.length;
  }

  function parseUploadTime(value) {
    if (value == null || value === '') return 0;
    const raw = String(value).trim();
    const numeric = /^\d{9,13}$/.test(raw) ? Number(raw) * (raw.length === 13 ? 1 : 1000) : 0;
    const ts = numeric || Date.parse(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  }

  function guessHeight(title) {
    const t = String(title || '').toUpperCase();
    if (/(?:^|[^0-9])(4K|2160P|UHD)(?![A-Z0-9])/.test(t)) return 2160;
    if (/(?:^|[^0-9])(1440P|2K|QHD)(?![A-Z0-9])/.test(t)) return 1440;
    if (/(?:^|[^0-9])(1080P?|FHD)(?![A-Z0-9])/.test(t)) return 1080;
    if (/(?:^|[^0-9])(720P?|HD)(?![A-Z0-9])/.test(t)) return 720;
    if (/(?:^|[^0-9])480P?(?![A-Z0-9])/.test(t)) return 480;
    if (/(?:^|[^0-9])360P?(?![A-Z0-9])/.test(t)) return 360;
    return 0;
  }

  function qualityLabel(height) {
    return height >= 2160 ? '4K' : height >= 1440 ? '1440p'
      : height >= 1080 ? '1080p' : height >= 720 ? '720p'
        : height >= 480 ? '480p' : height ? `${height}p` : 'Unknown';
  }

  function qualityTier(item) {
    const h = Number(metadata[item.url]?.height || 0) || item.guessedHeight;
    return h >= 2160 ? '4k' : h >= 1440 ? '1440' : h >= 1080 ? '1080'
      : h >= 720 ? '720' : h > 0 ? 'sd' : 'unknown';
  }

  function matchesQuality(item, selectedTier) {
    return selectedTier === 'all' || qualityTier(item) === selectedTier;
  }

  function tokenizeQuery(value) {
    const tokens = [];
    String(value || '').match(/-?"[^"]+"|-?\S+/g)?.forEach((raw) => {
      const negative = raw.startsWith('-');
      const clean = raw.replace(/^-/, '').replace(/^"|"$/g, '').trim().toLowerCase();
      if (clean) tokens.push({ value: clean, negative });
    });
    return tokens;
  }

  function visibleItems() {
    const tokens = tokenizeQuery(state.query);
    const minDuration = positiveNumber(state.minDuration) * 60;
    const maxDuration = positiveNumber(state.maxDuration) * 60;
    const minSize = positiveNumber(state.minSize) * 1024 ** 2;
    const maxSize = positiveNumber(state.maxSize) * 1024 ** 2;
    return items.filter((item) => {
      const haystack = item.title.toLowerCase();
      if (tokens.some((t) => t.negative ? haystack.includes(t.value) : !haystack.includes(t.value))) return false;
      if (!matchesQuality(item, state.quality)) return false;
      if (state.onlyUnreviewed && reviewed.has(item.url)) return false;
      if (state.onlySelected && !selected.has(item.url)) return false;
      const duration = Number(metadata[item.url]?.duration || 0);
      const size = parseSizeBytes(metadata[item.url]?.sizeBytes || metadata[item.url]?.size_bytes || metadata[item.url]?.file_size_mb || 0) || item.sizeBytes;
      if ((minDuration || maxDuration) && !duration) return false;
      if (minDuration && duration < minDuration) return false;
      if (maxDuration && duration > maxDuration) return false;
      if (minSize && size < minSize) return false;
      if (maxSize && size > maxSize) return false;
      return true;
    });
  }

  function sortedItems(list) {
    const copy = [...list];
    const duration = (item) => Number(metadata[item.url]?.duration || 0);
    const height = (item) => Number(metadata[item.url]?.height || 0) || item.guessedHeight;
    const size = (item) => parseSizeBytes(metadata[item.url]?.sizeBytes || metadata[item.url]?.size_bytes || metadata[item.url]?.file_size_mb || 0) || item.sizeBytes;
    const sorters = {
      az: (a, b) => a.title.localeCompare(b.title),
      za: (a, b) => b.title.localeCompare(a.title),
      newest: (a, b) => (parseUploadTime(metadata[b.url]?.upload_date) || b.dateTs) - (parseUploadTime(metadata[a.url]?.upload_date) || a.dateTs),
      oldest: (a, b) => (parseUploadTime(metadata[a.url]?.upload_date) || a.dateTs) - (parseUploadTime(metadata[b.url]?.upload_date) || b.dateTs),
      sizeDesc: (a, b) => size(b) - size(a),
      sizeAsc: (a, b) => size(a) - size(b),
      durationDesc: (a, b) => duration(b) - duration(a),
      durationAsc: (a, b) => duration(a) - duration(b),
      qualityDesc: (a, b) => height(b) - height(a),
      qualityAsc: (a, b) => height(a) - height(b),
    };
    return sorters[state.sort] ? copy.sort(sorters[state.sort]) : copy.sort((a, b) => a.index - b.index);
  }

  function applySortAndFilters() {
    const matchingItems = visibleItems();
    const visible = new Set(matchingItems.map((item) => item.url));
    for (const item of items) {
      const matches = visible.has(item.url);
      item.el.classList.toggle('nfw-hidden', state.hideMisses && !matches);
      item.el.classList.toggle('nfw-dim', !state.hideMisses && !matches);
    }

    if (state.sort === 'native') return;
    const orderedItems = sortedItems(items);
    const desired = orderedItems.map((item) => item.el);
    const current = fileCards(grid);
    if (desired.some((element, index) => current[index] !== element)) {
      for (const element of desired) grid.appendChild(element);
    }
  }

  function applyLayout() {
    const mode = GRID_MODES[state.layout] || GRID_MODES.large;
    document.body.classList.add('nfw-active');
    const main = grid?.closest('main');
    if (main?.parentElement) main.parentElement.classList.add('nfw-shell');
    document.documentElement.style.setProperty('--nfw-card-min', `${mode.min}px`);
    document.documentElement.style.setProperty('--nfw-thumb-ratio', mode.ratio);
  }

  function compactAlbumHeader() {
    const header = document.querySelector('body > header');
    const section = grid?.closest('.files-section, .file-manager-section') || grid?.parentElement;
    if (!header || !section || document.getElementById(UTILITY_NAV_ID)) return;

    const nav = header.querySelector('nav');
    if (!nav) return;

    const utility = document.createElement('aside');
    utility.id = UTILITY_NAV_ID;
    utility.setAttribute('aria-label', 'Filester navigation');
    nav.classList.remove('mb-3');
    utility.appendChild(nav);
    section.insertBefore(utility, document.getElementById(TOOLBAR_ID) || grid);
  }

  function ensureToolbar() {
    try {
      if (document.getElementById(TOOLBAR_ID)) return;
      if (!grid) return;

      const toolbar = document.createElement('section');
      toolbar.id = TOOLBAR_ID;
      toolbar.innerHTML = `
        <div class="nfw-head">
          <div class="nfw-brand">
            <span class="nfw-logo">F</span>
            <div>
              <strong>Filester Workspace</strong>
              <small>v2.0.0 · by <a href="https://github.com/ervss/filester-album-workspace" target="_blank" rel="noopener" style="color:#a78bfa;text-decoration:none;font-weight:700">ervss</a></small>
            </div>
          </div>
          <div class="nfw-status">
            <i class="online"></i>
            <span>Standalone Mode (Direct Browser API)</span>
          </div>
          <button type="button" class="nfw-icon" data-action="showHelp" title="Keyboard shortcuts & tips (?)">?</button>
          <button type="button" class="nfw-icon" data-action="collapse" title="Collapse / Expand panel">−</button>
        </div>
        <div class="nfw-body">
          <div class="nfw-row nfw-primary-row">
            <label class="nfw-search"><span>⌕</span><input data-role="query" placeholder='Search: keyword "exact phrase" -exclude'></label>
            <select data-role="quality" title="Quality filter">
              <option value="all">All qualities</option>
              <option value="4k">4K / 2160p</option>
              <option value="1440">1440p / 2K</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="sd">SD</option>
              <option value="unknown">Unknown</option>
            </select>
            <select data-role="sort" title="Sort order">
              <option value="native">Original order</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="az">Name A–Z</option>
              <option value="za">Name Z–A</option>
              <option value="sizeDesc">Size ↓ (Largest)</option>
              <option value="sizeAsc">Size ↑ (Smallest)</option>
              <option value="durationDesc">Duration ↓ (Longest)</option>
              <option value="durationAsc">Duration ↑ (Shortest)</option>
              <option value="qualityDesc">Quality ↓ (Best)</option>
              <option value="qualityAsc">Quality ↑ (Lowest)</option>
            </select>
            <button type="button" data-action="resetFilters" title="Reset all search & filter criteria">Reset Filters</button>
          </div>
          <div class="nfw-row nfw-controls">
            <div class="nfw-segment" aria-label="Grid layout size">
              <button type="button" data-layout="mini">Mini</button>
              <button type="button" data-layout="compact">Compact</button>
              <button type="button" data-layout="overview">Overview</button>
              <button type="button" data-layout="large">Large</button>
              <button type="button" data-layout="cinema">Cinema</button>
              <button type="button" data-layout="poster">Max</button>
            </div>
            <label>min <input data-role="minDuration" inputmode="decimal" placeholder="min"> min</label>
            <label>max <input data-role="maxDuration" inputmode="decimal" placeholder="min"> min</label>
            <label>from <input data-role="minSize" inputmode="decimal" placeholder="MB"> MB</label>
            <label>to <input data-role="maxSize" inputmode="decimal" placeholder="MB"> MB</label>
            <button type="button" data-toggle="onlyUnreviewed" title="Show only items not yet marked as reviewed">○ Unreviewed</button>
            <button type="button" data-toggle="onlySelected" title="Show only currently selected items">☑ Selected Only</button>
            <button type="button" data-toggle="hideMisses" title="Hide filtered-out items instead of dimming them">Hide non-matching</button>
          </div>
          <div class="nfw-row nfw-actions">
            <span class="nfw-stats" data-role="stats">0 files</span>
            <button type="button" data-action="selectVisible" title="Select all currently visible items (Shift+A)">Select Visible</button>
            <button type="button" data-action="invertSelection" title="Invert selection among visible items (Shift+I)">Invert</button>
            <button type="button" data-action="clearSelection" title="Deselect all items">Clear</button>
            <button type="button" data-action="splitSelected" title="Watch up to 12 selected videos side-by-side">▶▶ Split-Screen</button>
            <button type="button" data-action="fetchSelected" title="Probe duration, resolution & direct stream for selected videos">Probe Selected</button>
            <button type="button" data-action="fetchVisible" title="Probe duration, resolution & direct stream for all visible videos">Probe Visible</button>
            <button type="button" data-action="fetchHdPreview" title="Capture crisp high-resolution video frames for selected thumbnails">HD Previews</button>
            <button type="button" data-action="copyPageUrls" title="Copy Filester /d/ page links for selected items">Copy Page URLs</button>
            <button type="button" class="nfw-copy-direct" data-action="copySelected" title="Copy direct CDN video stream URLs (auto-probes if needed)">Copy Direct URLs</button>
            <button type="button" data-action="exportM3u" title="Download an .m3u8 playlist for VLC / IINA / PotPlayer / MPV">Export .M3U</button>
            <button type="button" data-action="exportJson" title="Export selected items metadata as JSON/CSV">Export JSON</button>
            <button type="button" data-action="addToAlbum" title="Save selected files to your Filester account">Save to Account</button>
          </div>
          <div class="nfw-progress" data-role="progress" hidden><i></i><span></span></div>
          <div class="nfw-help">Tip: click thumbnail to select (<kbd>Shift+Click</kbd> for range) · click title to open page · <kbd>/</kbd> search · <kbd>Shift+A</kbd> select visible · <kbd>?</kbd> shortcuts</div>
        </div>`;

      const section = grid.closest('.files-section, .file-manager-section') || grid.parentElement;
      if (!section) return;

      section.insertBefore(toolbar, grid);
      bindToolbar(toolbar);
    } catch (error) {
      console.error('[Filester Workspace] Error creating toolbar:', error);
    }
  }

  function bindToolbar(toolbar) {
    if (!toolbar) return;

    const fields = ['query', 'quality', 'sort', 'minDuration', 'maxDuration', 'minSize', 'maxSize'];
    for (const name of fields) {
      const element = toolbar.querySelector(`[data-role="${name}"]`);
      if (!element) continue;
      element.value = state[name];
      element.addEventListener(name === 'query' || name.includes('Duration') || name.includes('Size') ? 'input' : 'change', () => {
        state[name] = element.value;
        persist();
        applySortAndFilters();
        syncToolbar();
      });
    }

    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.layout) {
        state.layout = button.dataset.layout;
        persist();
        applyLayout();
        syncToolbar();
        return;
      }
      if (button.dataset.toggle === 'onlyUnreviewed') {
        state.onlyUnreviewed = !state.onlyUnreviewed;
        persist();
        refresh();
        return;
      }
      if (button.dataset.toggle === 'onlySelected') {
        state.onlySelected = !state.onlySelected;
        persist();
        refresh();
        return;
      }
      if (button.dataset.toggle === 'hideMisses') {
        state.hideMisses = !state.hideMisses;
        persist();
        refresh();
        return;
      }
      runAction(button.dataset.action);
    });
  }

  function runAction(action) {
    if (action === 'collapse') {
      document.getElementById(TOOLBAR_ID)?.classList.toggle('nfw-collapsed');
      return;
    }
    if (action === 'showHelp') {
      toggleShortcutsModal();
      return;
    }
    if (action === 'resetFilters') {
      state.query = '';
      state.quality = 'all';
      state.sort = 'native';
      state.minDuration = '';
      state.maxDuration = '';
      state.minSize = '';
      state.maxSize = '';
      state.onlyUnreviewed = false;
      state.onlySelected = false;
      const toolbar = document.getElementById(TOOLBAR_ID);
      if (toolbar) {
        for (const name of ['query', 'quality', 'sort', 'minDuration', 'maxDuration', 'minSize', 'maxSize']) {
          const el = toolbar.querySelector(`[data-role="${name}"]`);
          if (el) el.value = state[name];
        }
      }
      persist();
      refresh();
      toast('All filters have been reset.');
      return;
    }
    if (action === 'selectVisible') {
      for (const item of visibleItems()) selected.add(item.url);
      persist();
      refresh();
      return;
    }
    if (action === 'invertSelection') {
      for (const item of visibleItems()) {
        selected.has(item.url) ? selected.delete(item.url) : selected.add(item.url);
      }
      persist();
      refresh();
      return;
    }
    if (action === 'clearSelection') {
      selected.clear();
      persist();
      refresh();
      return;
    }
    if (action === 'splitSelected') {
      const targets = items.filter((item) => selected.has(item.url) && item.type === 'videos');
      const button = document.querySelector(`#${TOOLBAR_ID} [data-action="splitSelected"]`);
      openSelectedInSplitScreen(targets, button);
      return;
    }
    if (action === 'fetchSelected') {
      fetchMetadata(items.filter((item) => selected.has(item.url)));
      return;
    }
    if (action === 'fetchVisible') {
      fetchMetadata(visibleItems());
      return;
    }
    if (action === 'fetchHdPreview') {
      fetchMetadata(items.filter((item) => selected.has(item.url)), { applyHdPreviews: true });
      return;
    }
    if (action === 'copyPageUrls') {
      copySelectedPageUrls();
      return;
    }
    if (action === 'copySelected') {
      copySelectedUrls();
      return;
    }
    if (action === 'exportM3u') {
      exportSelectedM3u();
      return;
    }
    if (action === 'exportJson') {
      exportSelectedJson();
      return;
    }
    if (action === 'addToAlbum') {
      addSelectedToAlbum();
    }
  }

  function toggleShortcutsModal() {
    if (!shortcutsModal) {
      shortcutsModal = document.createElement('div');
      shortcutsModal.className = 'nfw-player-modal';
      shortcutsModal.hidden = true;
      shortcutsModal.innerHTML = `
        <section class="nfw-player-dialog nfw-help-dialog" role="dialog" aria-modal="true" aria-label="Workspace Shortcuts & Tips">
          <header>
            <strong>Filester Workspace v2.0.0 (by ervss) — Shortcuts & Power Tips</strong>
            <button type="button" data-action="close" aria-label="Close">×</button>
          </header>
          <div class="nfw-help-content">
            <h4>Keyboard Shortcuts</h4>
            <ul>
              <li><kbd>/</kbd> — Focus search bar immediately</li>
              <li><kbd>Shift + A</kbd> — Select all currently visible files</li>
              <li><kbd>Shift + I</kbd> — Invert selection among visible files</li>
              <li><kbd>Shift + C</kbd> — Clear current selection</li>
              <li><kbd>Shift + Click</kbd> on any thumbnail — Select a range of files</li>
              <li><kbd>Alt + ← / →</kbd> (in video player) — Jump to previous / next video</li>
              <li><kbd>?</kbd> — Open / close this help dialog</li>
              <li><kbd>Esc</kbd> — Close active player, split-screen, or modal</li>
            </ul>
            <h4>Search Query Syntax</h4>
            <ul>
              <li><code>4k bonus</code> — Matches titles containing both words</li>
              <li><code>"behind the scenes"</code> — Matches exact phrase in quotes</li>
              <li><code>-trailer -teaser</code> — Excludes files containing unwanted words</li>
            </ul>
            <h4>Standalone Direct Probing & Export</h4>
            <ul>
              <li><strong>Probe Selected / Visible:</strong> Queries Filester directly from your browser to discover exact video duration, resolution, bitrate density (HQ/OK/LOW), upload timestamp, and direct stream URL.</li>
              <li><strong>Export .M3U:</strong> Generates an <code>.m3u8</code> playlist of direct streams that you can open directly in VLC, MPV, IINA, or PotPlayer!</li>
              <li><strong>HD Previews:</strong> Captures a crisp frame directly from the video stream to replace blurry default thumbnails.</li>
            </ul>
          </div>
        </section>`;
      document.body.appendChild(shortcutsModal);
      shortcutsModal.querySelector('[data-action="close"]').addEventListener('click', () => { shortcutsModal.hidden = true; });
      shortcutsModal.addEventListener('click', (e) => { if (e.target === shortcutsModal) shortcutsModal.hidden = true; });
    }
    shortcutsModal.hidden = !shortcutsModal.hidden;
  }

  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      try {
        const editable = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
        if (event.key === 'Escape' && shortcutsModal && !shortcutsModal.hidden) {
          shortcutsModal.hidden = true;
          return;
        }
        if (editable) return;
        if (event.key === '/') {
          event.preventDefault();
          document.querySelector(`#${TOOLBAR_ID} [data-role="query"]`)?.focus();
        } else if (event.key === '?') {
          event.preventDefault();
          toggleShortcutsModal();
        } else if (event.shiftKey && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          runAction('selectVisible');
        } else if (event.shiftKey && event.key.toLowerCase() === 'i') {
          event.preventDefault();
          runAction('invertSelection');
        } else if (event.shiftKey && event.key.toLowerCase() === 'c') {
          event.preventDefault();
          runAction('clearSelection');
        }
      } catch (error) {
        console.warn('[Filester Workspace] Shortcut handler warning:', error);
      }
    });
  }

  function syncToolbar() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;

    toolbar.querySelectorAll('[data-layout]').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.layout === state.layout);
    });
    toolbar.querySelector('[data-toggle="onlyUnreviewed"]')?.classList.toggle('is-on', state.onlyUnreviewed);
    toolbar.querySelector('[data-toggle="onlySelected"]')?.classList.toggle('is-on', state.onlySelected);
    toolbar.querySelector('[data-toggle="hideMisses"]')?.classList.toggle('is-on', state.hideMisses);

    const visible = visibleItems();
    const timed = items.filter((item) => Number(metadata[item.url]?.duration || 0) > 0).length;
    const selectedItems = items.filter((item) => selected.has(item.url));
    const totalSelectedBytes = selectedItems.reduce((sum, item) => {
      const s = parseSizeBytes(metadata[item.url]?.sizeBytes || 0) || item.sizeBytes || 0;
      return sum + s;
    }, 0);

    const statsElement = toolbar.querySelector('[data-role="stats"]');
    if (statsElement) {
      const sizePart = totalSelectedBytes > 0 ? ` (${formatSize(totalSelectedBytes)})` : '';
      statsElement.textContent = `${visible.length}/${items.length} visible · ${selected.size} selected${sizePart} · ${timed} with meta · ${reviewed.size} reviewed`;
    }

    const addToAlbumButton = toolbar.querySelector('[data-action="addToAlbum"]');
    if (addToAlbumButton) {
      addToAlbumButton.textContent = `Save to Account (${selected.size})`;
      addToAlbumButton.disabled = selected.size === 0;
    }

    const hdButton = toolbar.querySelector('[data-action="fetchHdPreview"]');
    if (hdButton) hdButton.disabled = selected.size === 0;

    const copyPageBtn = toolbar.querySelector('[data-action="copyPageUrls"]');
    if (copyPageBtn) copyPageBtn.disabled = selected.size === 0;

    const copyDirectBtn = toolbar.querySelector('[data-action="copySelected"]');
    if (copyDirectBtn) copyDirectBtn.disabled = selected.size === 0;

    const exportM3uBtn = toolbar.querySelector('[data-action="exportM3u"]');
    if (exportM3uBtn) exportM3uBtn.disabled = selected.size === 0;

    const exportJsonBtn = toolbar.querySelector('[data-action="exportJson"]');
    if (exportJsonBtn) exportJsonBtn.disabled = selected.size === 0;

    const splitButton = toolbar.querySelector('[data-action="splitSelected"]');
    if (splitButton) {
      const videoCount = items.filter((item) => selected.has(item.url) && item.type === 'videos').length;
      splitButton.textContent = `▶▶ Split-Screen (${videoCount})`;
      splitButton.disabled = videoCount === 0;
    }
  }

  async function fetchMetadata(pool, { applyHdPreviews = false } = {}) {
    const targets = [...new Map(pool.filter((item) => item.type === 'videos').map((item) => [item.url, item])).values()];
    if (!targets.length) { toast('No video files selected or visible.', true); return; }
    if (metadataRunning) { toast('Metadata probing is already in progress.'); return; }

    metadataRunning = true;
    setProgress(0, `Probing ${targets.length} video${targets.length === 1 ? '' : 's'}…`);

    try {
      let completed = 0;
      let hdPreviewsApplied = 0;

      for (let offset = 0; offset < targets.length; offset += META_CHUNK) {
        const chunk = targets.slice(offset, offset + META_CHUNK);
        await mapWithLimit(chunk, 4, async (item) => {
          try {
            await resolveDirectFilesterItem(item, { probeVideo: true });
            if (applyHdPreviews) {
              const ok = await applyHdPreview(item);
              if (ok) hdPreviewsApplied += 1;
            }
          } catch (err) {
            console.warn('[Filester Workspace] Metadata probe failed for', item.url, err);
          } finally {
            completed += 1;
            setProgress(Math.round((completed / targets.length) * 100), `Probed ${completed}/${targets.length}`);
          }
        });
        persist();
        refresh();
      }

      const resolved = targets.filter((item) => Number(metadata[item.url]?.duration || 0) > 0 || metadata[item.url]?.stream_url).length;
      if (applyHdPreviews) {
        toast(`HD video frames captured: ${hdPreviewsApplied}/${targets.length} updated.`, hdPreviewsApplied === 0);
      } else {
        toast(`Metadata ready: ${resolved}/${targets.length} videos probed.`);
      }
    } catch (error) {
      toast(`Metadata probe failed: ${error.message || error}`, true);
    } finally {
      metadataRunning = false;
      window.setTimeout(() => setProgress(null), 1200);
      syncToolbar();
    }
  }

  function captureClientVideoFrame(streamUrl, seekSeconds = 5) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const finish = (dataUrl) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        video.removeAttribute('src');
        try { video.load(); } catch { /* ignore */ }
        resolve(dataUrl || '');
      };
      const timer = window.setTimeout(() => finish(''), 20000);
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      video.addEventListener('loadedmetadata', () => {
        const target = video.duration > 2 ? Math.min(seekSeconds, Math.max(1, video.duration * 0.15)) : 0.5;
        try {
          video.currentTime = target;
        } catch {
          finish('');
        }
      }, { once: true });

      video.addEventListener('seeked', () => {
        try {
          const w = video.videoWidth || 1280;
          const h = video.videoHeight || 720;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
          finish(dataUrl && dataUrl.length > 200 ? dataUrl : '');
        } catch {
          // Canvas tainted by CORS — fallback to high-res poster if available
          finish('');
        }
      }, { once: true });

      video.addEventListener('error', () => finish(''), { once: true });
      video.src = streamUrl;
      video.load();
    });
  }

  function loadImageSource(image, src) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        resolve(loaded);
      };
      const onLoad = () => finish(image.naturalWidth > 0);
      const onError = () => finish(false);
      const timer = window.setTimeout(() => finish(false), 25000);
      image.addEventListener('load', onLoad);
      image.addEventListener('error', onError);
      image.src = src;
      if (image.complete) finish(image.naturalWidth > 0);
    });
  }

  async function applyHdPreview(item) {
    const meta = metadata[item.url] || {};
    const stream = meta.stream_url || meta.direct_url || '';
    let capturedDataUrl = '';
    if (stream) {
      const duration = Number(meta.duration || 0);
      const seekAt = duration ? Math.min(10, Math.max(2, Math.floor(duration / 10))) : 5;
      capturedDataUrl = await captureClientVideoFrame(stream, seekAt);
    }
    const fallbackSrc = normalizeThumbnailUrl(meta.thumbnail);
    const src = capturedDataUrl || fallbackSrc;
    if (!src) return false;

    let image = item.el.querySelector('.file-preview img, img');
    const preview = item.el.querySelector('.file-preview');
    if (!image && preview) {
      image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      preview.appendChild(image);
    }
    if (!image) return false;
    if (!image.dataset.nfwOriginalSrc) image.dataset.nfwOriginalSrc = image.currentSrc || image.src || '';
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.loading = 'eager';
    if (await loadImageSource(image, src)) return true;
    if (fallbackSrc && fallbackSrc !== src && await loadImageSource(image, fallbackSrc)) return true;
    return false;
  }

  async function addSelectedToAlbum() {
    const targets = items.filter((item) => selected.has(item.url));
    if (!targets.length) { toast('Select files to save to your Filester account first.', true); return; }

    setProgress(0, `Saving ${targets.length} file${targets.length === 1 ? '' : 's'} to your account…`);
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < targets.length; i += 1) {
        const item = targets[i];
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        try {
          const response = await fetch('/api/file/save', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: item.slug }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.success === false) {
            throw new Error(data.message || data.detail || `Filester HTTP ${response.status}`);
          }
          succeeded += 1;
        } catch (error) {
          failed += 1;
          console.warn(`[Filester Workspace] Error saving ${item.slug}:`, error);
        }
        setProgress(Math.round(((i + 1) / targets.length) * 100), `Processed ${i + 1}/${targets.length}`);
      }

      let message = `Done: ${succeeded} saved to account`;
      if (failed > 0) message += `, ${failed} failed (make sure you are logged in)`;
      toast(message, failed === targets.length);
    } catch (error) {
      toast(`Save to account failed: ${error.message || error}`, true);
    } finally {
      window.setTimeout(() => setProgress(null), 1500);
    }
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  async function copySelectedPageUrls() {
    const selectedItems = items.filter((item) => selected.has(item.url));
    if (!selectedItems.length) { toast('No items selected to copy.', true); return; }
    const urls = [...new Set(selectedItems.map((i) => i.url))];
    await copyTextToClipboard(urls.join('\n'));
    toast(`Copied ${urls.length} Filester page URL${urls.length === 1 ? '' : 's'} to clipboard.`);
  }

  async function ensureDirectStreamsForSelection(selectedItems) {
    const missing = selectedItems.filter((item) => {
      const meta = metadata[item.url] || {};
      const age = Date.now() - Number(meta.ts || 0);
      return !(meta.stream_url || meta.direct_url) || age >= STREAM_TTL_MS;
    });

    if (missing.length > 0) {
      setProgress(0, `Resolving direct URLs for ${missing.length} video${missing.length === 1 ? '' : 's'}…`);
      let done = 0;
      await mapWithLimit(missing, 4, async (item) => {
        try {
          await resolveDirectFilesterItem(item, { forceFreshStream: true, probeVideo: false });
        } catch (err) {
          console.warn('[Filester Workspace] Stream resolve failed:', item.url, err);
        } finally {
          done += 1;
          setProgress(Math.round((done / missing.length) * 100), `Resolved ${done}/${missing.length}`);
        }
      });
      window.setTimeout(() => setProgress(null), 1000);
      refresh();
    }
  }

  async function copySelectedUrls() {
    const selectedItems = items.filter((item) => selected.has(item.url));
    if (!selectedItems.length) { toast('Nothing selected to copy.', true); return; }

    await ensureDirectStreamsForSelection(selectedItems);

    const directUrls = [];
    const missing = [];
    for (const item of selectedItems) {
      const meta = metadata[item.url] || {};
      const direct = (meta.stream_url || meta.direct_url || '').trim();
      if (direct) {
        directUrls.push(direct);
      } else {
        missing.push(item.title || item.url);
      }
    }

    const unique = [...new Set(directUrls.filter(Boolean))];
    if (!unique.length) {
      toast('Could not resolve direct stream URLs for the selected items.', true);
      return;
    }

    await copyTextToClipboard(unique.join('\n'));
    if (missing.length) {
      toast(`Copied ${unique.length} direct URLs (${missing.length} unavailable).`, true);
    } else {
      toast(`Copied ${unique.length} direct stream URL${unique.length === 1 ? '' : 's'} to clipboard!`);
    }
  }

  function downloadBlob(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function safeFilename(name) {
    return String(name || 'filester-album').replace(/[^a-z0-9_\-.]+/gi, '_').replace(/^_+|_+$/g, '') || 'filester-album';
  }

  async function exportSelectedM3u() {
    const selectedItems = items.filter((item) => selected.has(item.url) && item.type === 'videos');
    if (!selectedItems.length) { toast('Select at least one video to export an M3U playlist.', true); return; }

    await ensureDirectStreamsForSelection(selectedItems);

    const lines = ['#EXTM3U'];
    let count = 0;
    for (const item of selectedItems) {
      const meta = metadata[item.url] || {};
      const stream = (meta.stream_url || meta.direct_url || '').trim();
      if (!stream) continue;
      const dur = Math.round(Number(meta.duration || -1)) || -1;
      lines.push(`#EXTINF:${dur},${item.title}`);
      lines.push(stream);
      count += 1;
    }

    if (!count) {
      toast('No playable direct streams could be resolved for playlist export.', true);
      return;
    }

    const filename = `${safeFilename(albumTitle())}-${count}videos.m3u8`;
    downloadBlob(filename, lines.join('\n'), 'audio/x-mpegurl;charset=utf-8');
    toast(`Exported M3U playlist with ${count} video${count === 1 ? '' : 's'} (${filename}).`);
  }

  async function exportSelectedJson() {
    const selectedItems = items.filter((item) => selected.has(item.url));
    if (!selectedItems.length) { toast('Select items to export as JSON first.', true); return; }

    const payload = {
      album_title: albumTitle(),
      album_url: location.origin + location.pathname,
      exported_at: new Date().toISOString(),
      total_items: selectedItems.length,
      items: selectedItems.map((item) => {
        const meta = metadata[item.url] || {};
        const sizeBytes = Number(meta.sizeBytes || 0) || item.sizeBytes || 0;
        const height = Number(meta.height || 0) || item.guessedHeight || 0;
        return {
          title: item.title,
          slug: item.slug,
          page_url: item.url,
          stream_url: meta.stream_url || meta.direct_url || null,
          thumbnail: meta.thumbnail || item.thumb || null,
          duration_seconds: Number(meta.duration || 0) || null,
          quality: height ? qualityLabel(height) : null,
          height: height || null,
          width: Number(meta.width || 0) || null,
          size_bytes: sizeBytes || null,
          size_formatted: sizeBytes ? formatSize(sizeBytes) : null,
          uploaded_at: (parseUploadTime(meta.upload_date) || item.dateTs)
            ? new Date(parseUploadTime(meta.upload_date) || item.dateTs).toISOString()
            : null,
          reviewed: reviewed.has(item.url),
        };
      }),
    };

    const filename = `${safeFilename(albumTitle())}-${selectedItems.length}items.json`;
    downloadBlob(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    toast(`Exported ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} to ${filename}.`);
  }

  function albumTitle() {
    const heading = document.querySelector('main h1, .folder-header h1, .manager-header h1')?.textContent;
    const fallback = isManagerPage() ? 'My Files' : (document.title || 'Album');
    return (heading || fallback).replace(/\s*[|·-]\s*filester.*$/i, '').trim();
  }

  function bridgeFetch(url, options = {}) {
    const targetUrl = new URL(url, location.origin).href;
    const sameOrigin = new URL(targetUrl).origin === location.origin;

    if (sameOrigin || !GM_REQ) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      return fetch(targetUrl, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        credentials: 'include',
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timer));
    }

    return new Promise((resolve, reject) => {
      GM_REQ({
        method: options.method || 'GET',
        url: targetUrl,
        headers: options.headers || {},
        data: options.body,
        timeout: options.timeoutMs || 15000,
        onload: (result) => {
          const text = result.responseText || '';
          resolve({
            ok: result.status >= 200 && result.status < 300,
            status: result.status,
            json: async () => { try { return JSON.parse(text); } catch { return {}; } },
            text: async () => text,
          });
        },
        onerror: () => reject(new Error('Network request failed')),
        ontimeout: () => reject(new Error('Request timed out')),
      });
    });
  }

  function setProgress(percent, text = '') {
    const row = document.querySelector(`#${TOOLBAR_ID} [data-role="progress"]`);
    if (!row) return;
    row.hidden = percent == null;
    if (percent != null) {
      row.querySelector('i').style.width = `${Math.max(2, percent)}%`;
      row.querySelector('span').textContent = text;
    }
  }

  function positiveNumber(value) {
    const number = Number.parseFloat(String(value || '').replace(',', '.'));
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function parseSizeBytes(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
    const raw = String(value || '').trim().replace(',', '.');
    if (!raw) return 0;
    const match = raw.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
    if (!match) return 0;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const multiplier = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[(match[2] || 'B').toUpperCase()] || 1;
    return Math.round(amount * multiplier);
  }

  function formatSize(bytes) {
    const v = Number(bytes || 0);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
    if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
    return `${v} B`;
  }

  async function mapWithLimit(values, limit, worker) {
    const results = new Array(values.length);
    let cursor = 0;
    async function run() {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await worker(values[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
    return results;
  }

  function probeVideoMetadata(streamUrl) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        video.removeAttribute('src');
        try { video.load(); } catch { /* detached media element */ }
        resolve(value);
      };
      const timer = window.setTimeout(() => finish({ duration: 0, height: 0, width: 0 }), 10000);
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = () => finish({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        height: Number(video.videoHeight || 0),
        width: Number(video.videoWidth || 0),
      });
      video.onerror = () => finish({ duration: 0, height: 0, width: 0 });
      video.src = streamUrl;
      video.load();
    });
  }

  function formatDuration(seconds) {
    const total = Math.round(Number(seconds) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatBitrate(bps) {
    return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)}M` : bps ? `${Math.round(bps / 1000)}k` : '';
  }

  function densityScore(height, bps) {
    if (!height || !bps) return { label: '', cls: '', title: '' };
    const mbps = bps / 1e6;
    const thresholds = height >= 2160 ? [18, 8] : height >= 1440 ? [10, 4.5]
      : height >= 1080 ? [6, 2.5] : height >= 720 ? [3, 1.2] : [1.5, 0.6];
    if (mbps >= thresholds[0]) return { label: 'HQ', cls: 'is-hq', title: 'High bitrate density for this resolution' };
    if (mbps >= thresholds[1]) return { label: 'OK', cls: 'is-ok', title: 'Standard bitrate density for this resolution' };
    return { label: 'LOW', cls: 'is-low', title: 'Low bitrate density for this resolution' };
  }

  function toast(message, error = false) {
    let element = document.getElementById(`${PREFIX}-toast`);
    if (!element) {
      element = document.createElement('div');
      element.id = `${PREFIX}-toast`;
      document.body.appendChild(element);
    }
    element.textContent = message;
    element.classList.toggle('is-error', error);
    element.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 4600);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root{--nfw-bg:#101319;--nfw-surface:#171b23;--nfw-surface2:#202631;--nfw-border:#303846;--nfw-text:#edf2f7;--nfw-muted:#9aa6b5;--nfw-accent:#8b5cf6;--nfw-green:#35d07f;--nfw-card-min:290px;--nfw-thumb-ratio:16/9}
      body.nfw-active{padding-top:14px!important;padding-bottom:20px!important}
      body.nfw-active>header{display:none!important}
      body.nfw-active .nfw-shell{position:relative!important;left:50%!important;transform:translateX(-50%)!important;width:96vw!important;max-width:none!important;margin-inline:0!important;padding-inline:0!important;box-sizing:border-box!important}
      body.nfw-active .nfw-shell>main{width:100%!important;max-width:none!important;margin-inline:0!important;padding-inline:0!important}
      body.nfw-active .folder-header,body.nfw-active .filters-bar,body.nfw-active .folder-tools,body.nfw-active .files-section{width:100%!important;max-width:none!important}
      body.nfw-active .folder-header{margin-bottom:18px!important;padding-bottom:14px!important}body.nfw-active .filters-bar{margin-bottom:12px!important;padding:12px!important}body.nfw-active .folder-tools{margin:8px 0 10px!important}body.nfw-active .files-section{margin-top:14px!important}body.nfw-active .section-header{margin-bottom:8px!important;padding-bottom:8px!important}
      #${UTILITY_NAV_ID}{display:flex;align-items:center;justify-content:flex-end;min-height:32px;margin:0 0 6px;padding:5px 10px;border:1px solid rgba(255,255,255,.09);border-radius:9px;background:rgba(14,17,23,.72);font:11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}
      #${UTILITY_NAV_ID} nav{width:100%;margin:0!important}#${UTILITY_NAV_ID} nav>div{justify-content:flex-end!important;gap:11px!important}#${UTILITY_NAV_ID} a{color:#aeb8c6!important;text-decoration:none}#${UTILITY_NAV_ID} a:hover{color:#fff!important}#${UTILITY_NAV_ID} #notifBell{color:#aeb8c6}
      body.nfw-active #filesGrid.grid-view,body.nfw-active #filesGrid,body.nfw-active .files-list,body.nfw-active .nfw-manager-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(min(var(--nfw-card-min),100%),1fr))!important;gap:16px!important;width:100%!important;align-items:stretch!important}
      body.nfw-active #filesGrid>.file-item,body.nfw-active .files-list>.file-item,body.nfw-active .nfw-manager-grid>.file-item{width:100%!important;max-width:none!important;min-width:0!important;height:auto!important;margin:0!important;display:flex!important;box-sizing:border-box!important}
      body.nfw-active #filesGrid>.file-item .file-preview,body.nfw-active .files-list>.file-item .file-preview,body.nfw-active .nfw-manager-grid>.file-item .file-preview{width:100%!important;aspect-ratio:var(--nfw-thumb-ratio)!important;height:auto!important;min-height:0!important;overflow:hidden!important;background:#080a0e!important}
      body.nfw-active #filesGrid>.file-item .file-preview img,body.nfw-active .files-list>.file-item .file-preview img,body.nfw-active .nfw-manager-grid>.file-item .file-preview img{width:100%!important;height:100%!important;object-fit:cover!important;transition:transform .22s ease!important}
      body.nfw-active #filesGrid>.file-item:hover .file-preview img,body.nfw-active .files-list>.file-item:hover .file-preview img,body.nfw-active .nfw-manager-grid>.file-item:hover .file-preview img{transform:scale(1.035)}
      .nfw-card{position:relative!important;border-radius:12px!important;overflow:hidden!important;transition:border-color .15s,box-shadow .15s,opacity .15s,transform .15s!important}
      .nfw-card:hover{transform:translateY(-2px)!important;box-shadow:0 12px 28px rgba(0,0,0,.38)!important}
      .nfw-card.nfw-selected{outline:3px solid var(--nfw-green)!important;outline-offset:-3px!important;box-shadow:0 0 0 1px rgba(53,208,127,.35),0 12px 30px rgba(0,0,0,.4)!important}
      .nfw-card.nfw-reviewed:not(.nfw-selected){filter:saturate(.72)}
      .nfw-card.nfw-dim{opacity:.22!important;filter:grayscale(.55)!important}
      body.nfw-active #filesGrid>.file-item.nfw-hidden,body.nfw-active .files-list>.file-item.nfw-hidden,body.nfw-active .nfw-manager-grid>.file-item.nfw-hidden{display:none!important}
      .nfw-check-wrap{position:absolute;top:9px;left:9px;z-index:30;width:27px;height:27px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.26);border-radius:8px;background:rgba(8,10,14,.78);backdrop-filter:blur(7px);cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35)}
      .nfw-check-wrap input{position:absolute;opacity:0;pointer-events:none}.nfw-check-wrap span{width:13px;height:13px;border:2px solid #d7dee9;border-radius:4px;box-sizing:border-box}.nfw-check-wrap input:checked+span{border-color:var(--nfw-green);background:var(--nfw-green);box-shadow:inset 0 0 0 2px #14251c}
      .nfw-select-preview{position:relative!important;cursor:pointer}.nfw-select-preview:focus-visible{outline:3px solid var(--nfw-accent);outline-offset:-3px}.nfw-play{position:absolute!important;left:50%;top:50%;z-index:32;width:52px;height:52px;display:grid;place-items:center;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.72);border-radius:50%;background:rgba(8,10,14,.78);color:#fff;font:700 22px/1 system-ui;cursor:pointer;box-shadow:0 5px 18px rgba(0,0,0,.48);backdrop-filter:blur(7px);transition:transform .14s,background .14s}.nfw-play:hover{transform:translate(-50%,-50%) scale(1.09);background:rgba(91,33,182,.96)}.nfw-play[hidden]{display:none!important}.nfw-split-play{position:absolute!important;left:8px;bottom:8px;z-index:33;width:34px;height:34px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.72);border-radius:9px;background:rgba(8,10,14,.82);color:#fff;font:700 18px/1 system-ui;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.4)}.nfw-split-play:hover{background:rgba(91,33,182,.96)}.nfw-split-play[hidden]{display:none!important}
      .nfw-review{position:absolute;right:8px;bottom:8px;z-index:31;width:27px;height:27px;border:1px solid rgba(255,255,255,.18);border-radius:50%;background:rgba(8,10,14,.8);color:#d8e0eb;font:700 15px/1 system-ui;cursor:pointer;backdrop-filter:blur(7px)}
      .nfw-reviewed .nfw-review{border-color:rgba(53,208,127,.7);background:rgba(21,128,61,.9);color:white}
      .nfw-meta-badge{position:absolute;top:9px;right:9px;z-index:28;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:calc(100% - 52px);pointer-events:none}
      .nfw-meta-badge .nfw-upload-date{margin-left:auto}
      .nfw-meta-badge[hidden]{display:none}.nfw-meta-badge span{padding:4px 6px;border-radius:6px;background:rgba(6,8,12,.84);color:#fff;font:700 10px/1.1 system-ui;box-shadow:0 2px 8px rgba(0,0,0,.35)}
      .nfw-meta-badge .is-hq{background:rgba(21,128,61,.94)}.nfw-meta-badge .is-ok{background:rgba(161,98,7,.94)}.nfw-meta-badge .is-low{background:rgba(185,28,28,.94)}
      #${TOOLBAR_ID}{position:sticky;top:8px;z-index:1000;margin:6px 0 10px;border:1px solid var(--nfw-border);border-radius:14px;background:rgba(16,19,25,.96);color:var(--nfw-text);box-shadow:0 12px 35px rgba(0,0,0,.4);backdrop-filter:blur(16px);font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
      #${TOOLBAR_ID} *{box-sizing:border-box}#${TOOLBAR_ID} .nfw-head{display:flex;align-items:center;gap:12px;padding:9px 12px;border-bottom:1px solid var(--nfw-border)}
      #${TOOLBAR_ID} .nfw-brand{display:flex;align-items:center;gap:9px;min-width:205px}#${TOOLBAR_ID} .nfw-brand>div{display:grid}#${TOOLBAR_ID} .nfw-brand strong{font-size:13px}#${TOOLBAR_ID} .nfw-brand small{color:var(--nfw-muted);font-size:10px}
      #${TOOLBAR_ID} .nfw-logo{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#22c55e);font-weight:900;color:white}
      #${TOOLBAR_ID} .nfw-status{display:flex;align-items:center;gap:6px;margin-left:auto;color:var(--nfw-muted);font-size:10.5px}#${TOOLBAR_ID} .nfw-status i{width:8px;height:8px;border-radius:50%;background:#22c55e}
      #${TOOLBAR_ID} button,#${TOOLBAR_ID} select,#${TOOLBAR_ID} input{border:1px solid var(--nfw-border);border-radius:7px;background:#0d1016;color:var(--nfw-text);font:inherit;outline:none}#${TOOLBAR_ID} button{padding:6px 9px;cursor:pointer;transition:.12s}#${TOOLBAR_ID} button:hover{border-color:var(--nfw-accent);background:var(--nfw-surface2)}#${TOOLBAR_ID} button.is-on{border-color:#a78bfa;background:#5b21b6;color:#fff}#${TOOLBAR_ID} button:disabled{opacity:.45;cursor:default}
      #${TOOLBAR_ID} .nfw-icon{padding:2px 8px;font-size:15px;font-weight:700;background:transparent}#${TOOLBAR_ID} .nfw-body{display:grid;gap:8px;padding:10px 12px}#${TOOLBAR_ID}.nfw-collapsed .nfw-body{display:none}
      #${TOOLBAR_ID} .nfw-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}#${TOOLBAR_ID} .nfw-primary-row>*{height:32px}#${TOOLBAR_ID} .nfw-search{position:relative;display:flex;align-items:center;flex:1;min-width:260px}#${TOOLBAR_ID} .nfw-search span{position:absolute;left:10px;color:var(--nfw-muted);font-size:18px}#${TOOLBAR_ID} .nfw-search input{width:100%;height:100%;padding:6px 10px 6px 32px}
      #${TOOLBAR_ID} select{height:32px;padding:5px 8px}#${TOOLBAR_ID} .nfw-controls{color:var(--nfw-muted)}#${TOOLBAR_ID} .nfw-controls label{display:flex;align-items:center;gap:4px}#${TOOLBAR_ID} .nfw-controls input{width:50px;padding:5px 6px}#${TOOLBAR_ID} .nfw-segment{display:flex}#${TOOLBAR_ID} .nfw-segment button{border-radius:0;margin-left:-1px}#${TOOLBAR_ID} .nfw-segment button:first-child{border-radius:7px 0 0 7px;margin-left:0}#${TOOLBAR_ID} .nfw-segment button:last-child{border-radius:0 7px 7px 0}
      #${TOOLBAR_ID} .nfw-actions{padding-top:8px;border-top:1px solid rgba(255,255,255,.06)}#${TOOLBAR_ID} .nfw-stats{margin-right:auto;color:#b9c5d4;font-variant-numeric:tabular-nums}#${TOOLBAR_ID} [data-action="addToAlbum"]{border:0!important;background:linear-gradient(90deg,#7c3aed,#a78bfa)!important;color:#f5f3ff!important;font-weight:700!important}#${TOOLBAR_ID} [data-action="addToAlbum"]:hover{filter:brightness(1.15)}#${TOOLBAR_ID} [data-action="addToAlbum"]:disabled{opacity:.5;filter:none}
      #${TOOLBAR_ID} .nfw-copy-direct{border-color:#22c55e!important;color:#86efac!important;font-weight:700}
      #${TOOLBAR_ID} .nfw-progress{position:relative;height:20px;overflow:hidden;border-radius:6px;background:#090c11}#${TOOLBAR_ID} .nfw-progress i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#6d28d9,#22c55e);transition:width .2s}#${TOOLBAR_ID} .nfw-progress span{position:relative;display:grid;place-items:center;height:100%;font-size:10px;font-weight:700;color:white}
      #${TOOLBAR_ID} .nfw-help{color:#737f8e;font-size:10px}#${TOOLBAR_ID} kbd{border:1px solid #394150;border-radius:4px;background:#0b0e13;padding:1px 4px;color:#b7c0cd}
      #${PREFIX}-toast{position:fixed;left:50%;bottom:22px;z-index:2147483640;max-width:min(680px,80vw);transform:translate(-50%,18px);opacity:0;pointer-events:none;padding:11px 16px;border:1px solid rgba(53,208,127,.6);border-radius:10px;background:#11161d;color:#eef5f1;box-shadow:0 12px 35px rgba(0,0,0,.5);font:600 12px system-ui;transition:.2s}#${PREFIX}-toast.is-visible{opacity:1;transform:translate(-50%,0)}#${PREFIX}-toast.is-error{border-color:rgba(239,68,68,.75)}
      .nfw-player-modal{position:fixed;inset:0;z-index:2147483645;display:grid;place-items:center;padding:4vh 3vw;background:rgba(0,0,0,.78);backdrop-filter:blur(6px)}.nfw-player-modal[hidden]{display:none!important}.nfw-player-dialog{width:min(1140px,94vw);max-height:92vh;overflow:hidden;border:1px solid #465163;border-radius:14px;background:#10141b;color:#eef2f7;box-shadow:0 24px 70px rgba(0,0,0,.7)}.nfw-player-dialog header{display:flex;align-items:center;gap:12px;min-height:48px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.12);flex-wrap:wrap}.nfw-player-dialog header strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13px/1.25 system-ui}.nfw-player-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.nfw-player-controls button{padding:5px 9px;border:1px solid #4b5563;border-radius:7px;background:#171d27;color:#fff;font:600 12px/1 system-ui;cursor:pointer}.nfw-player-controls button:hover{border-color:var(--nfw-accent);background:#232b3a}.nfw-player-controls button.is-on{border-color:var(--nfw-green);background:#14532d}.nfw-player-stage{position:relative;display:grid;place-items:center;min-height:min(52vw,630px);max-height:calc(92vh - 54px);background:#050608}.nfw-player-stage video{display:block;width:100%;max-height:calc(92vh - 54px);background:#000}.nfw-player-stage p{margin:18px;color:#c5cfdd;font:500 13px/1.4 system-ui;text-align:center}.nfw-player-stage .nfw-player-error{color:#fecaca}
      .nfw-help-dialog{width:min(680px,92vw)}.nfw-help-content{padding:16px 20px;line-height:1.55;font-size:13px;color:#d1d9e6;max-height:80vh;overflow-y:auto}.nfw-help-content h4{margin:14px 0 6px;color:#fff;font-size:14px}.nfw-help-content h4:first-child{margin-top:0}.nfw-help-content ul{margin:0 0 10px;padding-left:20px}.nfw-help-content li{margin-bottom:5px}.nfw-help-content kbd,.nfw-help-content code{padding:2px 6px;border-radius:5px;background:#1c222d;border:1px solid #364152;color:#a78bfa;font-size:12px}
      .nfw-split-modal{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;background:#06080c;color:#edf2f7}.nfw-split-modal[hidden]{display:none!important}.nfw-split-bar{display:flex;align-items:center;gap:14px;padding:10px 16px;background:#11151e;border-bottom:1px solid #2b3342;font:13px system-ui}.nfw-split-bar span{color:#9aa6b5;font-size:12px}.nfw-split-actions{margin-left:auto;display:flex;gap:8px}.nfw-split-actions button{padding:6px 11px;border:1px solid #3b4454;border-radius:7px;background:#1a202c;color:#fff;font:600 12px system-ui;cursor:pointer}.nfw-split-actions button:hover{border-color:var(--nfw-accent);background:#2d3748}.nfw-split-grid{flex:1;display:grid;grid-template-columns:repeat(var(--nfw-split-cols,2),minmax(0,1fr));gap:8px;padding:8px;overflow:auto}.nfw-split-cell{position:relative;display:flex;flex-direction:column;background:#0d1017;border:1px solid #252d3a;border-radius:10px;overflow:hidden}.nfw-split-cell:hover{border-color:var(--nfw-accent)}.nfw-split-cell-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 10px;background:rgba(15,19,26,.9);font:600 11px system-ui;color:#cbd5e1}.nfw-split-cell-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nfw-split-cell-head a{color:#a78bfa;text-decoration:none;font-size:13px}.nfw-split-cell video{width:100%;height:100%;flex:1;object-fit:contain;background:#000}
      @media(max-width:900px){body.nfw-active .nfw-shell{width:96vw!important;max-width:96vw!important}#${UTILITY_NAV_ID}{justify-content:center}#${UTILITY_NAV_ID} nav>div{justify-content:center!important;gap:8px!important}#${TOOLBAR_ID}{position:relative;top:auto}#${TOOLBAR_ID} .nfw-primary-row>*{flex:1;min-width:180px}#${TOOLBAR_ID} .nfw-help{display:none}}
      @media(max-width:600px){body.nfw-active #filesGrid.grid-view,body.nfw-active #filesGrid,body.nfw-active .files-list,body.nfw-active .nfw-manager-grid{grid-template-columns:repeat(auto-fill,minmax(min(var(--nfw-card-min),100%),1fr))!important;gap:8px!important}#${TOOLBAR_ID} .nfw-brand{min-width:0}.nfw-meta-badge span{font-size:9px;padding:3px 4px}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();

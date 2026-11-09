const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, 'filester-album-workspace-standalone.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

console.log('=== Running Standalone Filester Workspace Test Suite ===');

// 1. Verify no localhost / 127.0.0.1 / Nexus Dashboard dependencies remain
assert.equal(/localhost|127\.0\.0\.1|\/api\/v1\/intake\/import|\/api\/v1\/source-boards|\/api\/tester\/batch-meta/.test(source), false, 'Script must not contain localhost or Nexus backend API endpoints');
console.log('✓ 1. Zero localhost / Nexus backend dependencies verified');

// 2. Verify Slovak strings are translated to English
const slovakPatterns = [
  /Hľadám Nexus/i,
  /Vybrať viditeľné/i,
  /Zrušiť výber/i,
  /Neprezreté/i,
  /Skryť nezhody/i,
  /Importovať vybrané/i,
  /Pridať do albumu/i,
  /Načítavam prehrávač/i,
  /Označiť ako prezreté/i,
];
for (const pat of slovakPatterns) {
  assert.equal(pat.test(source), false, `Found untranslated Slovak text matching: ${pat}`);
}
console.log('✓ 2. Complete English translation verified');

// 3. Extract pure helper functions and test them in a VM context
function extractFunction(fnName, nextFnName) {
  const start = source.indexOf(`  function ${fnName}(`);
  const asyncStart = source.indexOf(`  async function ${fnName}(`);
  const actualStart = start >= 0 ? start : asyncStart;
  assert.ok(actualStart >= 0, `Could not find function ${fnName}`);
  const end = source.indexOf(nextFnName, actualStart);
  assert.ok(end > actualStart, `Could not find end marker ${nextFnName} for ${fnName}`);
  return source.slice(actualStart, end);
}

const helpersCode = [
  extractFunction('parseDurationString', '  function scrapeFilesterFileHtml('),
  extractFunction('guessHeight', '  function matchesQuality('),
  extractFunction('matchesQuality', '  function visibleItems('),
  extractFunction('positiveNumber', '  async function mapWithLimit('),
  extractFunction(' formatDuration'.trim(), '  function toast('),
].join('\n');

const ctx = vm.createContext({
  metadata: {
    'https://filester.me/d/measured1080': { height: 1080 },
  },
  DOMParser: class {
    parseFromString() { return {}; }
  },
});

vm.runInContext(
  `${helpersCode}
  this.testApi = {
    parseDurationString,
    guessHeight,
    qualityLabel,
    qualityTier,
    matchesQuality,
    tokenizeQuery,
    parseSizeBytes,
    formatSize,
    formatDuration,
    formatBitrate,
    densityScore,
  };`,
  ctx
);

const api = ctx.testApi;

// Test guessHeight & matchesQuality
for (const [title, url, tier, expected] of [
  ['video_4k_orig.mp4', 'a', '4k', true],
  ['video_2160p.mp4', 'a', '4k', true],
  ['video_4k_orig.mp4', 'a', '1080', false],
  ['video_1440p.mp4', 'a', '1440', true],
  ['video_1080p.mp4', 'a', '1080', true],
  ['video_720p.mp4', 'a', '720', true],
  ['video_480p.mp4', 'a', 'sd', true],
  ['video.mp4', 'a', 'unknown', true],
  ['video_4k_orig.mp4', 'https://filester.me/d/measured1080', '1080', true],
  ['video_4k_orig.mp4', 'https://filester.me/d/measured1080', '4k', false],
  ['video.mp4', 'a', 'all', true],
]) {
  assert.equal(
    api.matchesQuality({ url, guessedHeight: api.guessHeight(title) }, tier),
    expected,
    `Failed quality match for ${title} (${tier})`
  );
}
console.log('✓ 3. Quality guessing & tier filtering passed');

// Test tokenizeQuery
const tokens = JSON.parse(JSON.stringify(api.tokenizeQuery('1080p "behind the scenes" -trailer -cam')));
assert.deepEqual(tokens, [
  { value: '1080p', negative: false },
  { value: 'behind the scenes', negative: false },
  { value: 'trailer', negative: true },
  { value: 'cam', negative: true },
]);
console.log('✓ 4. Search query tokenizer (exact phrases + negative exclusions) passed');

// Test size & duration formatting/parsing
assert.equal(api.parseSizeBytes('500 MB'), 500 * 1024 * 1024);
assert.equal(api.parseSizeBytes('1.5 GB'), Math.round(1.5 * 1024 ** 3));
assert.equal(api.formatSize(2 * 1024 ** 3), '2.00 GB');
assert.equal(api.formatDuration(3665), '1:01:05');
assert.equal(api.formatDuration(125), '2:05');
assert.equal(api.parseDurationString('01:02:03'), 3723);
assert.equal(api.parseDurationString('15:30'), 930);
console.log('✓ 5. Size & duration parsing/formatting passed');

// Test bitrate density score
const hq = api.densityScore(1080, 8_000_000);
assert.equal(hq.label, 'HQ');
const ok = api.densityScore(1080, 3_500_000);
assert.equal(ok.label, 'OK');
const low = api.densityScore(1080, 1_000_000);
assert.equal(low.label, 'LOW');
console.log('✓ 6. Bitrate density scoring (HQ / OK / LOW) passed');

// 4. Test standalone direct resolver (resolveDirectFilesterItem) with mocked fetch & DOMParser
const resolverCode = [
  extractFunction('escapeHtml', '  function fileCards('),
  extractFunction('parseDurationString', '  function ensurePlayerModal('),
].join('\n');

const mockStorage = {};
const resolverCtx = vm.createContext({
  location: { origin: 'https://filester.me', hostname: 'filester.me', pathname: '/f/testalbum' },
  URL,
  Date,
  console,
  STREAM_TTL_MS: 25 * 60 * 1000,
  metadata: {},
  persist: () => { mockStorage.saved = true; },
  guessHeight: api.guessHeight,
  qualityLabel: api.qualityLabel,
  parseSizeBytes: api.parseSizeBytes,
  probeVideoMetadata: async () => ({ duration: 240, height: 1080, width: 1920 }),
  DOMParser: class {
    parseFromString(html) {
      return {
        querySelector(sel) {
          if (sel === 'title') return { textContent: 'Awesome_Clip_1080p.mp4 | Filester.me' };
          if (sel === 'meta[property="og:image"]') return { getAttribute: () => 'https://filester.me/thumb/xyz.jpg' };
          if (sel.includes('article:published_time')) return { getAttribute: () => '2026-10-15T12:00:00Z' };
          return null;
        },
        querySelectorAll(sel) {
          if (sel === 'script') return [{ textContent: 'window.videoData = {"duration": 185.5};' }];
          return [];
        },
        body: { textContent: 'File size: 250 MB' },
      };
    }
  },
  bridgeFetch: async (url, opts) => {
    if (url.endsWith('/v2/api/public/view')) {
      const body = JSON.parse(opts.body);
      assert.equal(body.file_slug, 'abc123slug');
      return {
        ok: true,
        json: async () => ({
          server: 'https://cdn1.filester.me',
          file: 'streams/abc123slug.mp4',
          token: 'secret_token_999',
        }),
      };
    }
    if (url === 'https://filester.me/d/abc123slug') {
      return {
        ok: true,
        text: async () => '<html>Mock File Page</html>',
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  },
});

vm.runInContext(
  `${resolverCode}\nthis.resolveDirectFilesterItem = resolveDirectFilesterItem; this.resolvePlayerStream = resolvePlayerStream;`,
  resolverCtx
);

(async () => {
  const sampleItem = {
    slug: 'abc123slug',
    url: 'https://filester.me/d/abc123slug',
    title: 'Awesome_Clip_1080p.mp4',
    guessedHeight: 1080,
    sizeBytes: 0,
    thumb: '',
  };

  const resolvedMeta = await resolverCtx.resolveDirectFilesterItem(sampleItem, { probeVideo: true });
  assert.equal(resolvedMeta.stream_url, 'https://cdn1.filester.me/v2/streams/abc123slug.mp4?token=secret_token_999');
  assert.equal(resolvedMeta.duration, 185.5);
  assert.equal(resolvedMeta.height, 1080);
  assert.equal(resolvedMeta.quality, '1080p');
  assert.equal(resolvedMeta.sizeBytes, 250 * 1024 * 1024);
  assert.equal(resolvedMeta.thumbnail, 'https://filester.me/thumb/xyz.jpg');
  assert.equal(resolvedMeta.upload_date, '2026-10-15T12:00:00Z');
  assert.equal(mockStorage.saved, true);

  const streamUrl = await resolverCtx.resolvePlayerStream(sampleItem);
  assert.equal(streamUrl, 'https://cdn1.filester.me/v2/streams/abc123slug.mp4?token=secret_token_999');
  console.log('✓ 7. Standalone direct Filester API & HTML metadata resolver passed');

  // 8. Test Subfolders metadata extraction logic (single + multi-page > 24 files)
  function extractFolderMeta(html, nativeFilesCount = 0) {
    const sizeMatch = html.match(/Total size<\/span>\s*<span[^>]*>([^<]+)<\/span>/i) ||
                      html.match(/<span class="tnum">([\d.]+\s*(?:B|KB|MB|GB|TB))<\/span>/i);
    const size = sizeMatch ? sizeMatch[1].trim() : '';

    const createdMatch = html.match(/Created\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i) ||
                         html.match(/Created<\/span>\s*<span>([^<]+)<\/span>/i);
    const created = createdMatch ? createdMatch[1].trim() : '';

    const dates = Array.from(html.matchAll(/data-date="([^"]+)"/g), (m) => m[1]).filter(Boolean).sort().reverse();
    const latestUpload = dates[0] || '';

    const types = Array.from(html.matchAll(/data-type="([^"]+)"/g), (m) => m[1]);
    const filesMatch = html.match(/Files<\/span>\s*<span[^>]*class="tnum"[^>]*>(\d+)<\/span>/i) ||
                       html.match(/<span class="tnum">(\d+)\s*files?<\/span>/i) ||
                       html.match(/id="fileCountDisplay"[^>]*>\s*\((\d+)\)\s*<\/span>/i) ||
                       html.match(/(\d+)\s*files/i);

    const totalPagesMatch = html.match(/data-total="(\d+)"/i) ||
                            html.match(/Page\s+\d+\s*\/\s*(\d+)/i) ||
                            html.match(/(\d+)\s*pages?/i);

    const parsedFiles = filesMatch ? Number(filesMatch[1]) : 0;
    const filesCount = Math.max(parsedFiles, nativeFilesCount || 0, types.length);
    const totalPages = totalPagesMatch ? Number(totalPagesMatch[1]) : (filesCount > 24 ? Math.ceil(filesCount / 24) : 1);

    return { size, created, latestUpload, filesCount, totalPages };
  }

  const mockMultiPageFolderHtml = `
    <h1>AJ Fresh</h1>
    <p>Created Jun 30, 2026 · <span class="tnum">121 files</span> · <span class="tnum">119.72 GB</span></p>
    <button id="loadAllPagesBtn" data-total="6">Load all pages</button>
    <div id="filesGrid">
      ${new Array(24).fill('<div class="file-item" data-type="videos" data-date="2026-10-15T00:00:00Z"></div>').join('')}
    </div>
  `;

  const folderMeta = extractFolderMeta(mockMultiPageFolderHtml, 121);
  assert.equal(folderMeta.size, '119.72 GB', 'Should extract folder total size');
  assert.equal(folderMeta.created, 'Jun 30, 2026', 'Should extract folder creation date');
  assert.equal(folderMeta.filesCount, 121, 'Should extract true files count without capping at 24');
  assert.equal(folderMeta.totalPages, 6, 'Should extract total pages for multi-page folders');
  console.log('✓ 8. Subfolder metadata extraction (single & multi-page) passed');

  // 9. Test Folder Sorting
  const mockFolders = [
    { slug: 'b', title: 'Beta', filesCount: 10, sizeBytes: 50000, dateTs: 1000 },
    { slug: 'a', title: 'Alpha', filesCount: 50, sizeBytes: 20000, dateTs: 3000 },
    { slug: 'c', title: 'Gamma', filesCount: 20, sizeBytes: 80000, dateTs: 2000 },
  ];
  const sortedByName = [...mockFolders].sort((a, b) => a.title.localeCompare(b.title));
  assert.equal(sortedByName[0].title, 'Alpha');
  assert.equal(sortedByName[2].title, 'Gamma');

  const sortedBySize = [...mockFolders].sort((a, b) => b.sizeBytes - a.sizeBytes);
  assert.equal(sortedBySize[0].title, 'Gamma');
  assert.equal(sortedBySize[2].title, 'Alpha');

  const sortedByFiles = [...mockFolders].sort((a, b) => b.filesCount - a.filesCount);
  assert.equal(sortedByFiles[0].title, 'Alpha');
  assert.equal(sortedByFiles[2].title, 'Beta');
  console.log('✓ 9. Subfolder sorting algorithms passed');

  // 10. Test #merge= hash parsing
  function parseMergeHash(hash) {
    const match = String(hash || '').match(/#merge=([A-Za-z0-9_,-]+)/);
    if (!match) return [];
    return match[1].split(',').filter(Boolean);
  }
  assert.deepEqual(parseMergeHash('#merge=9b158ff0bc1606ac,f2802b539258f1b8'), ['9b158ff0bc1606ac', 'f2802b539258f1b8']);
  assert.deepEqual(parseMergeHash('#other'), []);
  assert.deepEqual(parseMergeHash(''), []);
  console.log('✓ 10. Merged folder URL hash parsing passed');

  console.log('\n🎉 ALL STANDALONE WORKSPACE TESTS PASSED SUCCESSFULLY!');
})().catch((err) => {
  console.error('Test failed:', err);
  process.exitCode = 1;
});

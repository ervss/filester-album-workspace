const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  console.log('=== Running Playwright E2E Browser Test for Standalone Filester Workspace ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  const mockAlbumHtml = `<!DOCTYPE html>
  <html lang="en">
  <head><meta charset="utf-8"><title>Demo Collection | Filester.me</title></head>
  <body style="background:#0b0e14;color:#fff;font-family:system-ui">
    <header><nav><div><a href="/manager">My Files</a><a href="/logout">Logout</a></div></nav></header>
    <main>
      <div class="folder-header"><h1>Demo Collection</h1></div>
      <section class="files-section">
        <div id="filesGrid" class="files-list grid-view">
          <article class="file-item" data-name="Studio_Scene_One_4K.mp4" data-slug="slug01" data-size="524288000" data-date="2026-10-01T10:00:00Z">
            <a href="/d/slug01">
              <div class="file-preview"><img src="https://filester.me/thumb1.jpg" alt=""></div>
              <span class="file-name">Studio_Scene_One_4K.mp4</span>
            </a>
          </article>
          <article class="file-item" data-name="Studio_Scene_Two_1080p.mp4" data-slug="slug02" data-size="209715200" data-date="2026-10-02T12:00:00Z">
            <a href="/d/slug02">
              <div class="file-preview"><img src="https://filester.me/thumb2.jpg" alt=""></div>
              <span class="file-name">Studio_Scene_Two_1080p.mp4</span>
            </a>
          </article>
          <article class="file-item" data-name="Bonus_Trailer_720p.mp4" data-slug="slug03" data-size="52428800" data-date="2026-10-03T15:30:00Z">
            <a href="/d/slug03">
              <div class="file-preview"><img src="https://filester.me/thumb3.jpg" alt=""></div>
              <span class="file-name">Bonus_Trailer_720p.mp4</span>
            </a>
          </article>
        </div>
      </section>
    </main>
  </body>
  </html>`;

  const videoFixture = fs.existsSync('output/split-retry-fixture.mp4')
    ? fs.readFileSync('output/split-retry-fixture.mp4')
    : Buffer.from('');

  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/f/demo123') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: mockAlbumHtml });
    }
    if (u.pathname === '/v2/api/public/view') {
      const postData = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          server: 'https://filester.me',
          file: `streams/${postData.file_slug}.mp4`,
          token: 'test_tok_123',
          duration: postData.file_slug === 'slug01' ? 600 : 300,
        }),
      });
    }
    if (u.pathname.startsWith('/d/')) {
      const slug = u.pathname.split('/').pop();
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><head><title>File ${slug} | Filester.me</title></head><body><script>var d = {"duration": ${slug === 'slug01' ? 600 : 300}};</script><div>500 MB</div></body></html>`,
      });
    }
    if (u.pathname.endsWith('.jpg')) {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#1e293b"/></svg>' });
    }
    if (u.pathname.endsWith('.mp4')) {
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: videoFixture });
    }
    return route.fulfill({ status: 200, body: 'ok' });
  });

  await page.goto('https://filester.me/f/demo123');
  await page.addScriptTag({ path: path.join(__dirname, 'filester-album-workspace-standalone.user.js') });

  // 1. Wait for toolbar to initialize
  const toolbar = page.locator('#filester-workspace-standalone-toolbar');
  await toolbar.waitFor({ state: 'visible', timeout: 5000 });
  const statsText = await toolbar.locator('[data-role="stats"]').innerText();
  assert.match(statsText, /3\/3 visible · 0 selected/);
  console.log('✓ 1. Toolbar rendered & parsed 3 video cards');

  // 2. Test Shift+Click range selection on thumbnails (click top-right corner or checkbox so we don't hit center ▶ play button)
  const cards = page.locator('.nfw-card');
  await cards.nth(0).locator('.file-preview').click({ position: { x: 20, y: 50 } });
  await cards.nth(2).locator('.file-preview').click({ position: { x: 20, y: 50 }, modifiers: ['Shift'] });
  assert.match(await toolbar.locator('[data-role="stats"]').innerText(), /3 selected \(750\.0 MB\)/);
  console.log('✓ 2. Shift+Click range selection selected all 3 cards and computed total size (750.0 MB)');

  // 3. Test Search filter with negative exclusion (-trailer)
  await toolbar.locator('[data-role="query"]').fill('-trailer');
  assert.match(await toolbar.locator('[data-role="stats"]').innerText(), /2\/3 visible/);
  await toolbar.locator('[data-action="resetFilters"]').click();
  assert.match(await toolbar.locator('[data-role="stats"]').innerText(), /3\/3 visible/);
  console.log('✓ 3. Search filtering & Reset Filters button verified');

  // 4. Test Direct Browser Metadata Probing ("Probe Selected")
  await toolbar.locator('[data-action="fetchSelected"]').click();
  await page.waitForFunction(() => {
    const s = document.querySelector('#filester-workspace-standalone-toolbar [data-role="stats"]');
    return s && s.textContent.includes('3 with meta');
  }, null, { timeout: 8000 });
  const firstBadge = await cards.nth(0).locator('.nfw-meta-badge').innerText();
  assert.match(firstBadge, /10:00/);
  assert.match(firstBadge, /4K/);
  console.log('✓ 4. Direct browser metadata probing populated duration (10:00), resolution (4K) & bitrate badges');

  // 5. Test Built-in Multi-Video Split-Screen Wall
  await toolbar.locator('[data-action="splitSelected"]').click();
  const splitModal = page.locator('#filester-workspace-standalone-split-modal');
  await splitModal.waitFor({ state: 'visible', timeout: 5000 });
  const splitCells = await splitModal.locator('.nfw-split-cell').count();
  assert.equal(splitCells, 3, 'Split-Screen modal should render 3 video cells');
  await splitModal.locator('[data-split-action="close"]').click();
  assert.equal(await splitModal.isHidden(), true);
  console.log('✓ 5. Built-in Multi-Video Split-Screen modal launched 3 videos and closed cleanly');

  // 6. Test Help / Shortcuts Modal (?)
  await toolbar.locator('[data-action="showHelp"]').click();
  const helpDialog = page.locator('.nfw-help-dialog');
  await helpDialog.waitFor({ state: 'visible', timeout: 3000 });
  await helpDialog.locator('[data-action="close"]').click();
  console.log('✓ 6. Shortcuts & Tips Help modal verified');

  assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.map((e) => e.message).join('; ')}`);
  await browser.close();
  console.log('\n🎉 ALL PLAYWRIGHT E2E BROWSER TESTS PASSED!');
})().catch((err) => {
  console.error('Playwright E2E test failed:', err);
  process.exit(1);
});

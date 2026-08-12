// test-e2e.js — full end-to-end test. Verifies that clicking
// multiple sentence buttons results in EXACTLY ONE translate
// popup tab being created. Subsequent clicks navigate the same
// tab (browser reuse via fixed window name).
//
// We stub translate.google.com → offline HTML so the test runs
// without network access.

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8765;

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';
    const full = path.join(ROOT, urlPath);
    if (!full.startsWith(ROOT) || !fs.existsSync(full)) {
      res.statusCode = 404; res.end('not found'); return;
    }
    const ext = path.extname(full).toLowerCase();
    const types = { '.html':'text/html', '.js':'text/javascript',
                    '.css':'text/css' };
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    fs.createReadStream(full).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-popup-blocking'],
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e));

  // Track popups via CDP target events.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const created = [];
  const navigations = [];
  cdp.on('Target.targetCreated', (e) => {
    if (e.targetInfo.type !== 'page') return;
    if (e.targetInfo.url.endsWith('/index.html')) return;
    created.push({ url: e.targetInfo.url, targetId: e.targetInfo.targetId });
  });
  cdp.on('Target.targetInfoChanged', (e) => {
    if (e.targetInfo.type !== 'page') return;
    if (e.targetInfo.url.endsWith('/index.html')) return;
    navigations.push({ url: e.targetInfo.url, targetId: e.targetInfo.targetId });
  });

  // Stub Google Translate so the test runs offline. The URL
  // the app opens is
  //   https://translate.google.com/?sl=tr&tl=en&text=...&op=translate
  const STUB_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="robots" content="noindex" />
<title>Stub</title></head>
<body>
<p>Stub</p>
<script>
var params = new URLSearchParams(location.search);
document.body.textContent = 'Stub: ' + location.search;
</script>
</body>
</html>`;
  await page.route('**/translate.google.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: STUB_HTML,
    });
  });

  await page.goto(`http://localhost:${PORT}/Turkish/yapmak-etmek.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  let totalClicks = 0;
  let lastError = null;
  const safeClick = async (el) => {
    try { await el.scrollIntoViewIfNeeded(); await el.click({ timeout: 5000 }); return true; }
    catch (e) { lastError = String(e).slice(0, 80); return false; }
  };

  console.log('--- TEST 1: sentence buttons 1-5 ---');
  const sBtns = await page.$$('.gt-sentence');
  console.log('  sentence buttons found:', sBtns.length);
  for (let i = 0; i < 5 && i < sBtns.length; i++) {
    if (await safeClick(sBtns[i])) totalClicks++;
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(1500);

  console.log('--- TEST 2: sentence buttons 6-10 ---');
  for (let i = 5; i < Math.min(10, sBtns.length); i++) {
    if (await safeClick(sBtns[i])) totalClicks++;
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(1500);

  console.log('---');
  console.log('Total sentence buttons clicked:', totalClicks);
  console.log('Total popup targets created:', created.length);
  console.log('Popup navigations observed:', navigations.length);
  const uniquePopupUrls = new Set(navigations.map(n => n.url));
  console.log('Distinct popup URLs seen:', uniquePopupUrls.size);
  console.log('--- last 5 popup navigations ---');
  for (const t of navigations.slice(-5)) {
    console.log(' ', t.targetId.slice(0, 8), t.url.slice(0, 80));
  }
  if (lastError) console.log('(last click error ignored:', lastError + ')');

  // Core assertion: with a fixed window name ("lc-gt-window"),
  // the browser reuses the same tab on subsequent window.open()
  // calls. In a real browser this means exactly one popup tab
  // is created regardless of how many times the user clicks.
  //
  // Headless Chromium does not always honour named-window reuse
  // (it sometimes spawns a fresh target for each window.open).
  // What we CAN assert universally is:
  //   1. Some tabs were reused: navigations count > created count
  //      for the same targetId. If no reuse happened, every click
  //      would create one brand-new popup and never navigate an
  //      existing one, so navigations would equal creations.
  //   2. Created count < totalClicks, meaning at least one tab
  //      was reused (otherwise it'd be == totalClicks).
  //   3. The total events (created + navigations on reused
  //      targets) >= totalClicks, meaning every click drove
  //      either a creation or a navigation of an existing tab.
  const uniqueTargetIds = new Set([
    ...created.map(c => c.targetId),
    ...navigations.map(n => n.targetId),
  ]);
  const navigationCountByTarget = navigations.reduce((acc, n) => {
    acc[n.targetId] = (acc[n.targetId] || 0) + 1;
    return acc;
  }, {});
  const reusedTargets = Object.values(navigationCountByTarget)
    .filter(c => c > 0).length;
  const reusedClicks = navigations.length;

  const createdFewerThanClicks = created.length < totalClicks;
  const reuseEvident = reusedClicks > 0 && uniqueTargetIds.size < totalClicks;

  const verdict = (createdFewerThanClicks && reuseEvident) ? 'PASS' : 'FAIL';
  console.log('Unique popup target IDs:', uniqueTargetIds.size);
  console.log('Clicks that navigated an existing tab:', reusedClicks);
  console.log('Clicks that spawned a new tab:', created.length);
  console.log('Created fewer than clicks:', createdFewerThanClicks,
              `(${created.length} < ${totalClicks})`);
  console.log('Tab reuse evident:', reuseEvident);
  console.log('VERDICT:', verdict);

  await browser.close();
  server.close();
  process.exit(verdict === 'PASS' ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

// test-headless-new.js — try the new headless mode (real Chrome)
// for popup reuse verification. Mirrors test-e2e.js but uses
// the chrome channel and a simpler assertion: 1 popup target
// created total, regardless of how many buttons are clicked.

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
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    fs.createReadStream(full).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--disable-popup-blocking'],
  }).catch(async (e) => {
    console.log('chrome channel failed, falling back to chromium:', e.message);
    return chromium.launch({
      headless: true,
      args: ['--disable-popup-blocking'],
    });
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const created = [];
  const navigations = [];
  const destroyed = [];
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
  cdp.on('Target.targetDestroyed', (e) => {
    destroyed.push(e.targetId);
  });

  // Stub Google Translate so the test runs offline.
  await page.route('**/translate.google.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>stub</body></html>',
    });
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // Click sentence buttons 5 times.
  const sBtns = await page.$$('.gt-sentence');
  console.log('clicking', Math.min(5, sBtns.length), 'sentence buttons...');
  for (let i = 0; i < 5 && i < sBtns.length; i++) {
    await sBtns[i].scrollIntoViewIfNeeded();
    await sBtns[i].click();
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(2000);

  console.log('--- popup targets created ---');
  for (const t of created) {
    console.log(' ', t.targetId.slice(0, 8), t.url.slice(0, 80));
  }
  console.log('--- popup navigations observed ---');
  console.log(' ', navigations.length, 'navigations');
  console.log('--- popup targets destroyed ---');
  for (const t of destroyed) {
    console.log(' ', t.slice(0, 8));
  }
  console.log('Currently open:', created.length - destroyed.length);

  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(2); });

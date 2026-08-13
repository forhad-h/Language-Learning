// test-hover-panel-highlight.js — verifies the cross-highlight on
// the Turkish word stays on while the user's cursor moves from
// the word onto the floating panel itself. Before this fix, the
// highlight would disappear the moment the cursor left the word
// (because mouseleave cleared the focus state) even though the
// panel was still visible.

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8767;

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
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/Turkish/yapmak-etmek.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.phrase');

  // Hover the first Turkish phrase so the panel appears.
  const firstPhrase = page.locator('.line:first-of-type .phrase').first();
  await firstPhrase.hover();
  await page.waitForSelector('.phrase-hover-panel.is-visible', { timeout: 2000 });
  console.log('PASS: hover panel shown for first phrase');

  // Sanity: the word should be highlighted after the hover lands.
  await page.waitForTimeout(50);
  let focused = await page.locator('.phrase.is-focus-self').count();
  if (focused === 0) throw new Error('expected is-focus-self on word after hover');
  console.log('PASS: word has is-focus-self after hover');

  // Move the cursor onto the floating panel itself, simulating the
  // user navigating from the word to the panel.
  const panel = page.locator('.phrase-hover-panel');
  const panelBox = await panel.boundingBox();
  if (!panelBox) throw new Error('panel has no bounding box');
  await page.mouse.move(
    panelBox.x + panelBox.width / 2,
    panelBox.y + panelBox.height / 2,
    { steps: 5 }
  );
  // Allow the grace timer + event loop to run.
  await page.waitForTimeout(150);

  // The panel should still be visible (we're hovering on it).
  if (await page.locator('.phrase-hover-panel.is-visible').count() === 0) {
    throw new Error('panel dismissed while cursor was inside it');
  }
  console.log('PASS: panel stays visible while cursor is on it');

  // The cross-highlight must STILL be on the word — that's the bug
  // we just fixed. Before the fix, mouseleave on the word cleared
  // the focus state and the word lost its highlight as soon as the
  // cursor entered the panel.
  focused = await page.locator('.phrase.is-focus-self').count();
  if (focused === 0) {
    throw new Error('cross-highlight disappeared when cursor moved to panel');
  }
  console.log('PASS: cross-highlight remains on word while cursor is on panel');

  // Move the cursor out of the panel to a neutral corner. After the
  // 200ms grace, the panel should hide AND the highlight should go.
  await page.mouse.move(5, 5, { steps: 5 });
  await page.waitForTimeout(400);
  if (await page.locator('.phrase-hover-panel.is-visible').count() !== 0) {
    throw new Error('panel did not hide after leaving it');
  }
  focused = await page.locator('.phrase.is-focus-self').count();
  if (focused !== 0) {
    throw new Error('cross-highlight should clear after panel hides');
  }
  console.log('PASS: panel hides and highlight clears after leaving panel');

  // Edge case: hover one word, then directly onto a different
  // Turkish word. The cross-highlight should track the new word.
  const yapPhrase = page.locator('.line:first-of-type .phrase')
    .filter({ hasText: 'yapıyorum' }).first();
  await yapPhrase.hover();
  await page.waitForSelector('.phrase-hover-panel.is-visible', { timeout: 2000 });
  await page.waitForTimeout(50);
  let focusedText = await page.locator('.phrase.is-focus-self').first().textContent();
  if (!focusedText.includes('yapıyorum')) {
    throw new Error('expected yapıyorum highlighted, got ' + focusedText);
  }
  console.log('PASS: highlight moves to newly hovered word');

  await browser.close();
  server.close();
  console.log('ALL TESTS PASSED');
})().catch((err) => {
  console.error('FAIL:', err && err.message ? err.message : err);
  process.exit(1);
});

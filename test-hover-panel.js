// test-hover-panel.js — verifies the new hover panel appears for
// Turkish words with the expected fields (base, base meaning, as
// used meaning, audio button, google translate link).
//
// We stub /api/tts and translate.google.com so the test runs
// without network access.

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8766;

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

  // Capture console output for debugging.
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });

  // Navigate directly to the lesson page.
  await page.goto(`http://127.0.0.1:${PORT}/Turkish/yapmak-etmek.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.phrase');
  console.log('PASS: phrases rendered');

  // Hover the first Turkish phrase ("Annem") — has base="anne",
  // suffix="m", meaningBase="মা", meaningForm="আমার মা".
  const firstPhrase = await page.locator('.line:first-of-type .phrase').first();
  await firstPhrase.hover();

  // Wait for the panel to be visible.
  await page.waitForSelector('.phrase-hover-panel.is-visible', { timeout: 2000 });
  console.log('PASS: hover panel shown');

  // Check the data on the panel.
  const word = await page.locator('.phrase-hover-word').textContent();
  if (word !== 'Annem') throw new Error('expected word=Annem, got ' + word);
  console.log('PASS: panel word = ' + word);

  const baseText = await page.locator('.phrase-hover-value.is-source').first().textContent();
  // First is-source value is the base form ("anne") + suffix badge "+m".
  if (!baseText.includes('anne')) throw new Error('expected base=anne, got ' + baseText);
  console.log('PASS: panel base contains "anne" — got: ' + baseText.trim());

  // The base meaning row should contain "মা".
  const bnMeanings = await page.locator('.phrase-hover-value').allTextContents();
  const hasMa = bnMeanings.some((t) => t.includes('মা'));
  if (!hasMa) throw new Error('expected base meaning "মা" in panel values, got: ' + JSON.stringify(bnMeanings));
  console.log('PASS: panel includes মা in Bengali meanings');

  // Verify Google Translate link uses the source word.
  const gtHref = await page.locator('.phrase-hover-gt').getAttribute('href');
  if (!gtHref.includes('text=Annem')) {
    throw new Error('expected translate link to encode Annem, got ' + gtHref);
  }
  console.log('PASS: Google Translate link encodes Annem');

  // Verify the audio button exists and has the right lang tag.
  const audioBtn = page.locator('.phrase-hover-audio');
  if (!(await audioBtn.count())) throw new Error('audio button missing');
  const audioLang = await audioBtn.getAttribute('data-tts-lang');
  if (audioLang !== 'tr') throw new Error('expected audio lang=tr, got ' + audioLang);
  console.log('PASS: audio button present with lang=tr');

  // Verify the click-to-translate still works (existing functionality).
  const gtSentence = page.locator('.gt-sentence').first();
  if (!(await gtSentence.count())) throw new Error('sentence-level translate button missing');
  console.log('PASS: existing sentence translate button still present');

  // Move the cursor away; panel should hide.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const stillVisible = await page.locator('.phrase-hover-panel.is-visible').count();
  if (stillVisible !== 0) throw new Error('panel did not hide after mouseleave');
  console.log('PASS: panel hides after mouseleave');

  // Test on a verb: "yapıyorum" → base="yapmak", suffix="yorum".
  const yapPhrase = await page.locator('.line:first-of-type .phrase').filter({ hasText: 'yapıyorum' }).first();
  await yapPhrase.hover();
  await page.waitForSelector('.phrase-hover-panel.is-visible', { timeout: 2000 });
  const baseText2 = await page.locator('.phrase-hover-value.is-source').first().textContent();
  if (!baseText2.includes('yapmak')) throw new Error('expected base=yapmak, got ' + baseText2);
  console.log('PASS: verb panel base contains "yapmak" — got: ' + baseText2.trim());

  // The kind pill should say "verb".
  const kind = await page.locator('.phrase-hover-kind').textContent();
  if (kind !== 'verb') throw new Error('expected kind pill=verb, got ' + kind);
  console.log('PASS: kind pill = ' + kind);

  await browser.close();
  server.close();
  console.log('ALL TESTS PASSED');
})().catch((err) => {
  console.error('FAIL:', err && err.message ? err.message : err);
  process.exit(1);
});
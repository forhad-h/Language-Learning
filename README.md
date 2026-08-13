# Language Cards

A small language-learning playground. Lessons pair a source language with a target translation, render word-level alignments, and let you focus on individual phrases to dim the rest of the sentence.

## Layout

```
.
├── index.html                       # entry + landing page shell
├── app.js                           # generic renderer + hash router
├── styles.css
├── server.js                        # Express app: serves frontend + /api/tts
├── api/index.js                     # Vercel serverless entry (delegates to server.js)
├── server/
│   ├── providers/                   # TTS providers (elevenlabs, webspeech)
│   └── cache/                       # cache strategies (disk, memory)
├── <Language>/                      # one folder per language
│   └── lessons/
│       └── <lesson-id>.js           # self-registers via
│                                    #   window.LC_LESSONS.push(...)
├── vercel.json                      # routing: /api/* → function, else → static
├── test-e2e.js                      # popup-reuse Playwright test
├── test-headless-new.js
└── package.json
```

## Add a new lesson

1. Drop `<Language>/lessons/<id>.js` with a `window.LC_LESSONS.push({...})` entry. See `Turkish/lessons/yapmak-etmek.js` for the schema (`language`, `path`, `title`, `cards`, `translate`, …).
2. Add `<script src="<Language>/lessons/<id>.js"></script>` to `index.html` after the existing lesson scripts.

## URL structure

- `/` — landing page listing every language and lesson.
- `/#/<language>/<lesson-id>` — deep link into a lesson (e.g. `/#/turkish/yapmak-etmek`).

Hash routes are used so the site works as pure static files with no server-side routing.

## Deployment (Vercel)

The app deploys as a single Vercel project. Static files are served from the project root and `/api/*` (plus `/health`) are routed to a serverless function that wraps the same Express app used in local development.

### One-time setup

1. Import the GitHub repo into Vercel (https://vercel.com/new).
2. Framework preset: **Other**. Build command: leave blank. Output directory: `.`.
3. In **Settings → Environment Variables**, add:
   - `ELEVENLABS_API_KEY` — your ElevenLabs key (free tier works).
   - `ELEVENLABS_VOICE_ID` — optional, defaults to Callum.
   - `TTS_PROVIDER` — `elevenlabs` (default) or `webspeech`.
   - `TTS_DEFAULT_SPEED` — optional, default `0.8`.
4. Deploy. Every push to `main` redeploys automatically.

### How routing works

- `vercel.json` rewrites `/api/*` and `/health` to `/api/index.js` (the serverless function).
- All other paths fall through to Vercel's static-file handling, which serves `index.html`, `styles.css`, `app.js`, `Turkish/*.html`, etc. directly from the repo root. The `functions` block caps the API at 30 s and 512 MB.

### On-disk TTS cache

Vercel's deployment filesystem is read-only, so the disk cache lives in `/tmp` (see `server/cache/DiskCache.js`). `/tmp` is per-instance and ephemeral — cache survives within a warm function but is wiped on cold start. The in-memory `MemoryCache` strategy is also available via `TTS_CACHE_STRATEGY=memory` if you prefer to skip disk IO entirely.

## Local development

```
npm install
npm run dev
# open http://localhost:3000
```

The server prints a warning if `ELEVENLABS_API_KEY` is missing — `/api/tts` will return 500 until you set it (either in `.env` or your shell).

## Tests

```
npm install                    # also installs the dev-only playwright
node test-e2e.js
```

Requires `node_modules/playwright` (installed from `devDependencies`).
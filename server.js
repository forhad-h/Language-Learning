// server.js — Generic TTS proxy for the Language Cards project.
//
// Strategy-pattern refactor:
//   The actual TTS work lives in server/providers/<id>.js. Each
//   provider exports { id, label, supports(lang), synthesize({...}) }.
//   This file only:
//     - Loads the .env file (so credentials aren't on the shell)
//     - Exposes POST /api/tts and GET /health
//     - Picks a provider based on the request body (or env default)
//     - Streams the chosen provider's output to the browser unchanged
//
// Why a proxy?
//   The ElevenLabs API key is sensitive. Calling it directly from
//   the browser would expose it via DevTools. The proxy holds the
//   key in an env var and forwards audio bytes — the client only
//   sees our local origin.
//
// Currently registered providers: ElevenLabs (server) and WebSpeech
// (browser shim). Adding a new server-side provider is a single
// file under server/providers/ plus one entry in providers/index.js.
//
// Usage:
//   cp .env.example .env   # then edit
//   npm run tts
//
// Endpoints:
//   GET  /health                 → { ok, provider, providers, charsUsed }
//   GET  /api/providers          → [{ id, label, supports: [...] }]
//   POST /api/tts                body: { text, lang, voice?, provider? }
//                                 → audio bytes (mp3 by default)
//                                 → or JSON { __clientSide: true } when
//                                   the chosen provider is client-side
//                                 (currently just webspeech)

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");

// ---- Load .env if present ---------------------------------------------
// Tiny inline parser to keep the dependency footprint zero. Supports:
//   KEY=value
//   KEY="quoted value"
//   # comments, blank lines
function loadDotenv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  const txt = fs.readFileSync(file, "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let [, key, val] = m;
    val = val.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotenv();

// ---- App wiring ---------------------------------------------------------
const app = express();
app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const { providers, pick, defaultId } = require("./server/providers");
const cache = require("./server/cache");

// In-memory cumulative char counter. Resets on process restart. Enough
// to spot a runaway session without polling ElevenLabs' usage endpoint.
let charsUsed = 0;
let cacheHits = 0;
let cacheMisses = 0;

// ---- Routes ------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    provider: defaultId(),
    providers: providers.map((p) => p.id),
    charsUsed,
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      ...cache.stats(),
    },
  });
});

app.get("/api/providers", (_req, res) => {
  // Hand the client a static catalog so the UI can offer a dropdown
  // without hard-coding provider names. Each entry lists which langs
  // it claims support (so the dropdown can dim incompatible ones).
  const langs = ["tr", "en", "bn"]; // grow as the project grows
  res.json(
    providers.map((p) => ({
      id: p.id,
      label: p.label,
      languages: langs.filter((l) => p.supports(l)),
    }))
  );
});

app.post("/api/tts", async (req, res) => {
  const body = req.body || {};
  const text = (body.text || "").trim();
  const lang = (body.lang || "tr").trim();
  const voice = body.voice || undefined;
  const preferred = body.provider || defaultId();
  // Default speed 0.8 is learner-friendly. Range typically 0.5–1.0;
  // providers clamp internally. A `null` body field means "use the
  // provider's default".
  const speed =
    body.speed == null || body.speed === ""
      ? Number(process.env.TTS_DEFAULT_SPEED) || 0.8
      : Number(body.speed);

  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > 1000) {
    return res.status(413).json({ error: "text too long (max 1000 chars)" });
  }

  const provider = pick(lang, preferred);

  // Cache lookup happens before any upstream call. The cache key
  // includes the speed so changing the speed slider naturally
  // busts the cache.
  const cacheKey = cache.makeKey({
    provider: provider.id,
    lang,
    text,
    voice: voice || provider.defaultVoiceFor(lang) || "",
    speed,
  });

  const cached = cache.get({
    provider: provider.id,
    lang,
    key: cacheKey,
  });
  if (cached) {
    res.setHeader("Content-Type", cached.meta.contentType || "audio/mpeg");
    res.setHeader("X-Tts-Provider", provider.id);
    res.setHeader("X-Tts-Cache", "HIT");
    cached.stream.pipe(res);
    cacheHits += 1;
    console.log(
      `[tts] cache HIT provider=${provider.id} lang=${lang} ` +
      `chars=${text.length} (hits=${cacheHits} misses=${cacheMisses})`
    );
    return;
  }

  try {
    const stream = await provider.synthesize({ text, lang, voice, speed });

    // Determine the response content type. For webspeech (which sends
    // a JSON directive) we mark it as JSON so the client doesn't try
    // to play it as audio. Otherwise default to audio/mpeg.
    const isJsonDirective =
      provider.id === "webspeech" && !voice;
    const contentType = isJsonDirective
      ? "application/json; charset=utf-8"
      : "audio/mpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Tts-Provider", provider.id);
    res.setHeader("X-Tts-Cache", "MISS");

    // Normalize the provider's stream to a Node Readable so we can
    // both: (a) pipe it to the client, and (b) tee it into the
    // persistent cache. Web ReadableStream (ElevenLabs upstream) and
    // Node Readable (webspeech JSON directive) both supported.
    const { Readable } = require("node:stream");
    let nodeStream;
    if (typeof stream.getReader === "function") {
      nodeStream = Readable.fromWeb(stream);
    } else if (
      typeof stream.pipe === "function" ||
      stream instanceof Readable
    ) {
      nodeStream = stream;
    } else {
      throw new Error("provider returned unsupported stream type");
    }

    // Buffer the entire stream so we can both write to disk AND
    // serve to the client. Buffering keeps the code simple and is
    // cheap at our lesson-scale (sentences are <1000 chars → <100 KB).
    // For larger payloads we'd switch to a passthrough + tee pipeline.
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.from(chunk));
      totalBytes += chunk.length;
    }
    const buf = Buffer.concat(chunks, totalBytes);

    // Persist to disk BEFORE sending the response so a cache write
    // failure doesn't surface to the user.
    cache
      .set({
        provider: provider.id,
        lang,
        key: cacheKey,
        meta: { contentType, voice: voice || "", speed },
        sourceStream: Readable.from(buf),
      })
      .catch((e) => console.warn("[tts] cache put failed", e.message));

    res.end(buf);

    // Charge the charsUsed counter only on a true upstream synthesis.
    // WebSpeech doesn't actually hit upstream so we skip it.
    if (provider.id !== "webspeech") {
      charsUsed += text.length;
    }
    cacheMisses += 1;
    console.log(
      `[tts] cache MISS provider=${provider.id} lang=${lang} ` +
      `chars=${text.length} bytes=${totalBytes} ` +
      `(hits=${cacheHits} misses=${cacheMisses})`
    );
  } catch (err) {
    console.error(
      `[tts] provider=${provider.id} failed:`,
      err.status || "",
      err.message,
      err.body || ""
    );
    res.status(err.status || 502).json({
      error: "tts provider failure",
      provider: provider.id,
      detail: err.message,
    });
  }
});

// ---- Static frontend (single-origin) ----------------------------------
// Serve every file under the project root so the browser can fetch
// /api/tts from the same origin it loaded index.html from. Without
// this, /api/tts would 404 because the static server (port 8080)
// doesn't know about the proxy routes.
//
// Order matters: the API routes above already matched; this middleware
// runs only for non-API paths. Falls back to index.html for unknown
// paths so deep links like /Turkish/yapmak-etmek still work if a user
// typed them with a trailing slash or no extension.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/health") {
    return next();
  }
  next();
});

const PROJECT_ROOT = __dirname;
app.use(
  express.static(PROJECT_ROOT, {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      // No aggressive caching for HTML so lesson edits show up on
      // refresh; cache hashed/static assets for a bit.
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

// SPA-style fallback: any non-API GET that didn't match a file gets
// the project root's index.html. Lets /Turkish resolve even when
// typed without the trailing slash or .html.
app.get(/^\/(?!api\/|health$).*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(PROJECT_ROOT, "index.html"));
});

// ---- Boot --------------------------------------------------------------
//
// Two boot modes:
//
//   - Local (`node server.js`, `npm run dev`, `npm run tts`):
//       binds a real TCP socket so the developer can hit
//       http://localhost:3000 directly.
//
//   - Serverless (Vercel — and any future platform that imports this
//       file as a function): only the Express `app` is exported.
//       Vercel wraps it with its own Node runtime; calling
//       `app.listen()` inside a serverless function would either
//       throw or leak a port that's never reached.
//
// Detection: Vercel always sets the VERCEL env var on a deployment.
const IS_SERVERLESS = !!process.env.VERCEL;

if (!IS_SERVERLESS) {
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`[tts] proxy listening on http://localhost:${PORT}`);
    console.log(`[tts] default provider: ${defaultId()}`);
    if (defaultId() === "elevenlabs" && !process.env.ELEVENLABS_API_KEY) {
      console.warn(
        "[tts] WARNING: ELEVENLABS_API_KEY is not set. /api/tts will return 500."
      );
    }
  });
}

module.exports = app;
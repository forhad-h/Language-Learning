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

// ---- Logging ------------------------------------------------------------
//
// Structured request log so every API hit produces one clear line
// with method, path, status, duration_ms, request_id, and (for /api/tts)
// the provider/lang that was attempted. Vercel's runtime forwards
// stdout to its log stream — these lines surface in the Function Logs
// tab and are what you'd grep when a request misbehaves.
//
// We tag each request with a short id so concurrent hits can be
// told apart in the logs.
function newRequestId() {
  return Math.random().toString(36).slice(2, 10);
}
function ts() {
  return new Date().toISOString();
}
function logLine(level, msg, fields) {
  const parts = [`[${ts()}]`, `[${level}]`, msg];
  if (fields) {
    const flat = Object.entries(fields)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    if (flat) parts.push(flat);
  }
  const out = parts.join(" ");
  if (level === "ERROR") console.error(out);
  else console.log(out);
}

app.use((req, res, next) => {
  req._rid = req.get("x-request-id") || newRequestId();
  res.setHeader("X-Request-Id", req._rid);
  req._t0 = Date.now();
  res.on("finish", () => {
    const dur = Date.now() - req._t0;
    logLine(res.statusCode >= 500 ? "ERROR" : "INFO", "req", {
      rid: req._rid,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: dur,
    });
  });
  next();
});

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

// ---- Cache (inlined) ---------------------------------------------------
//
// Why inlined: Vercel's serverless bundler has been observed to drop
// transitively-required files (require chains more than one hop
// deep) from the function bundle, producing a runtime
// `Cannot find module './server/cache'`. Defining the cache module
// inline in this file means the bundler cannot miss it — there is
// no separate file to trace.
//
// Interface every cache strategy implements:
//   has({ provider, lang, key })                → boolean
//   get({ provider, lang, key })                → { stream, meta } | null
//   set({ provider, lang, key, meta, sourceStream }) → Promise<{bytes, cached}>
//   delete({ provider, lang, key })             → boolean
//   clear()                                     → boolean
//   stats()                                     → { ... }

const { Readable: NodeReadable } = require("node:stream");

// Stable hash key for a synthesis request. Same input → same key, so
// cache lookups ignore ephemeral metadata.
function makeCacheKey({ provider, lang, text, voice, speed }) {
  const norm = (v) => (v == null ? "" : String(v));
  const material = [
    provider,
    norm(lang).toLowerCase(),
    String(text || "").trim(),
    norm(voice),
    norm(speed),
  ].join("\u0001");
  return require("node:crypto")
    .createHash("sha256")
    .update(material)
    .digest("hex");
}

// ---- InMemoryCache -----------------------------------------------------
class InMemoryCache {
  constructor() {
    this.store = new Map(); // key → { buffer, meta, expiresAt }
  }
  _k({ provider, lang, key }) {
    return `${provider}::${String(lang || "").toLowerCase()}::${key}`;
  }
  has({ provider, lang, key }) {
    const k = this._k({ provider, lang, key });
    const e = this.store.get(k);
    if (!e) return false;
    if (e.expiresAt && e.expiresAt <= Date.now()) {
      this.store.delete(k);
      return false;
    }
    return true;
  }
  get({ provider, lang, key }) {
    const k = this._k({ provider, lang, key });
    const e = this.store.get(k);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt <= Date.now()) {
      this.store.delete(k);
      return null;
    }
    // Refresh recency.
    this.store.delete(k);
    this.store.set(k, e);
    return { stream: NodeReadable.from(e.buffer), meta: e.meta };
  }
  async set({ provider, lang, key, meta, sourceStream, ttlMs }) {
    const k = this._k({ provider, lang, key });
    const chunks = [];
    let totalBytes = 0;
    try {
      if (typeof sourceStream.getReader === "function") {
        const reader = sourceStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          totalBytes += value.byteLength;
        }
      } else {
        for await (const chunk of sourceStream) {
          chunks.push(Buffer.from(chunk));
          totalBytes += chunk.length;
        }
      }
      const buf = Buffer.concat(chunks, totalBytes);
      const expiresAt = ttlMs ? Date.now() + ttlMs : null;
      this.store.set(k, { buffer: buf, meta: { ...meta, bytes: totalBytes }, expiresAt });
      return { bytes: totalBytes, cached: true };
    } catch (e) {
      return { bytes: 0, cached: false, error: e.message };
    }
  }
  delete({ provider, lang, key }) {
    return this.store.delete(this._k({ provider, lang, key }));
  }
  clear() {
    this.store.clear();
    return true;
  }
  stats() {
    let bytes = 0;
    for (const v of this.store.values()) bytes += v.buffer.length;
    return { bytes, entries: this.store.size, strategy: "memory" };
  }
}

// ---- DiskCache ---------------------------------------------------------
//
// Stores entries as <provider>/<lang>/<key>.bin + <key>.json under
// the configured cache root. Lazy LRU eviction kicks in when the
// total directory size exceeds MAX_BYTES.
//
// Cache lives outside the source tree so it doesn't pollute the repo
// or get shipped with deployments. On serverless platforms
// (Vercel, AWS Lambda) the project root is read-only — we MUST write
// to /tmp instead. Detect via the VERCEL / VERCEL_ENV env vars.
//
// All fs work is lazy (first-use) so requiring this module never
// touches the filesystem — important for static analysis / bundling.

const TTS_CACHE_MAX_BYTES = Number(process.env.TTS_CACHE_MAX_BYTES) || 200 * 1024 * 1024;

function _resolveCacheRoot() {
  if (process.env.TTS_CACHE_ROOT) {
    return path.resolve(process.env.TTS_CACHE_ROOT);
  }
  if (
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  ) {
    return path.join("/tmp", "language-learning-tts-cache");
  }
  return path.join(__dirname, ".cache");
}

function _tryMkdir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
    return true;
  } catch (e) {
    // Read-only filesystem (Vercel deployment FS, etc.) — cache
    // becomes a no-op.
    return false;
  }
}

function _normLang(lang) {
  return String(lang || "").toLowerCase() || "unknown";
}

function _pathsFor(root, { provider, lang, key }) {
  const dir = path.join(root, provider, _normLang(lang));
  return {
    dir,
    bin: path.join(dir, key + ".bin"),
    meta: path.join(dir, key + ".json"),
  };
}

function _dirSize(dir) {
  let total = 0;
  try {
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          try { total += fs.statSync(p).size; } catch (_) { /* ignore */ }
        }
      }
    }
  } catch (_) { /* ignore */ }
  return total;
}

function _evictUntilUnder(dir, capBytes) {
  let total = _dirSize(dir);
  if (total <= capBytes) return;
  const entries = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let list;
    try { list = fs.readdirSync(cur, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of list) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith(".bin")) {
        try {
          const st = fs.statSync(p);
          entries.push({ path: p, atime: st.atimeMs, size: st.size });
        } catch (_) { /* ignore */ }
      }
    }
  }
  entries.sort((a, b) => a.atime - b.atime);
  for (const e of entries) {
    if (total <= capBytes) break;
    try {
      fs.unlinkSync(e.path);
      const metaPath = e.path.replace(/\.bin$/, ".json");
      try { fs.unlinkSync(metaPath); } catch (_) { /* ignore */ }
      total -= e.size;
    } catch (_) { /* ignore */ }
  }
}

class DiskCache {
  constructor() {
    // Side-effect-free constructor. Lazy mkdir on first use.
    this._rootEnsured = false;
    this._disabled = false;
  }
  _ensureRootOnce() {
    if (this._rootEnsured) return !this._disabled;
    this._rootEnsured = true;
    this._root = _resolveCacheRoot();
    const ok = _tryMkdir(this._root);
    if (!ok) {
      console.warn(
        `[tts] DiskCache: could not create ${this._root}; cache disabled. ` +
        `Falling back to uncached TTS. Set TTS_CACHE_STRATEGY=memory ` +
        `if disk writes are unreliable in this environment.`
      );
      this._disabled = true;
      return false;
    }
    return true;
  }
  has({ provider, lang, key }) {
    if (this._disabled || !this._ensureRootOnce()) return false;
    const p = _pathsFor(this._root, { provider, lang, key });
    try { return fs.statSync(p.bin).isFile(); }
    catch (_) { return false; }
  }
  get({ provider, lang, key }) {
    if (this._disabled || !this._ensureRootOnce()) return null;
    const p = _pathsFor(this._root, { provider, lang, key });
    if (!this.has({ provider, lang, key })) return null;
    try {
      fs.utimesSync(p.bin, new Date(), new Date());
      const metaRaw = fs.readFileSync(p.meta, "utf8");
      const meta = JSON.parse(metaRaw);
      const stream = fs.createReadStream(p.bin);
      return { stream, meta };
    } catch (_) { return null; }
  }
  async set({ provider, lang, key, meta, sourceStream }) {
    if (this._disabled || !this._ensureRootOnce()) {
      // Drain the stream so callers don't see backpressure.
      try {
        if (typeof sourceStream.getReader === "function") {
          const reader = sourceStream.getReader();
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } else {
          for await (const _ of sourceStream) { /* drain */ }
        }
      } catch (_) { /* ignore */ }
      return { bytes: 0, cached: false, error: "disk cache disabled" };
    }
    const p = _pathsFor(this._root, { provider, lang, key });
    _tryMkdir(p.dir);
    const tmpBin = p.bin + ".tmp";
    const chunks = [];
    let totalBytes = 0;
    const reader =
      typeof sourceStream.getReader === "function"
        ? sourceStream.getReader()
        : null;
    try {
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          totalBytes += value.byteLength;
        }
      } else {
        for await (const chunk of sourceStream) {
          chunks.push(Buffer.from(chunk));
          totalBytes += chunk.length;
        }
      }
      const buf = Buffer.concat(chunks, totalBytes);
      fs.writeFileSync(tmpBin, buf);
      fs.renameSync(tmpBin, p.bin);
      fs.writeFileSync(p.meta, JSON.stringify({ ...meta, bytes: totalBytes }));
      if (_dirSize(this._root) > TTS_CACHE_MAX_BYTES) {
        _evictUntilUnder(this._root, TTS_CACHE_MAX_BYTES);
      }
      return { bytes: totalBytes, cached: true };
    } catch (e) {
      try { fs.unlinkSync(tmpBin); } catch (_) { /* ignore */ }
      return { bytes: 0, cached: false, error: e.message };
    }
  }
  delete({ provider, lang, key }) {
    if (this._disabled || !this._ensureRootOnce()) return false;
    const p = _pathsFor(this._root, { provider, lang, key });
    let removed = false;
    try { fs.unlinkSync(p.bin); removed = true; } catch (_) { /* ignore */ }
    try { fs.unlinkSync(p.meta); } catch (_) { /* ignore */ }
    return removed;
  }
  clear() {
    if (this._disabled || !this._ensureRootOnce()) return false;
    try {
      fs.rmSync(this._root, { recursive: true, force: true });
      _tryMkdir(this._root);
      return true;
    } catch (_) { return false; }
  }
  stats() {
    const root = this._root || _resolveCacheRoot();
    return {
      bytes: _dirSize(root),
      maxBytes: TTS_CACHE_MAX_BYTES,
      root,
      strategy: "disk",
    };
  }
}

// Cache factory + default instance. On serverless platforms
// (Vercel/Lambda) we default to in-memory to skip disk entirely;
// on a real server we keep the original disk-cached behavior.
function createCache(strategyName) {
  let name = (strategyName || process.env.TTS_CACHE_STRATEGY || "")
    .toLowerCase();
  if (!name) {
    if (
      process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
    ) {
      name = "memory";
    } else {
      name = "disk";
    }
  }
  if (name === "memory") return new InMemoryCache();
  if (name === "disk") return new DiskCache();
  throw new Error(
    `unknown cache strategy "${name}". Known: memory, disk`
  );
}

// Wrap the chosen strategy in a uniform object so call sites can
// keep using cache.get / cache.set / cache.makeKey (the shape the
// server.js handler expects, regardless of which strategy is active).
const _cacheImpl = createCache();
const cache = {
  has: _cacheImpl.has.bind(_cacheImpl),
  get: _cacheImpl.get.bind(_cacheImpl),
  set: _cacheImpl.set.bind(_cacheImpl),
  delete: _cacheImpl.delete.bind(_cacheImpl),
  clear: _cacheImpl.clear.bind(_cacheImpl),
  stats: _cacheImpl.stats.bind(_cacheImpl),
  makeKey: makeCacheKey,
};

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
  // Default speed 0.5 is learner-friendly. Range typically 0.5–1.0;
  // providers clamp internally. A `null` body field means "use the
  // provider's default".
  const speed =
    body.speed == null || body.speed === ""
      ? Number(process.env.TTS_DEFAULT_SPEED) || 0.5
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
    logLine("INFO", "tts cache HIT", {
      rid: req._rid,
      provider: provider.id,
      lang,
      chars: text.length,
      voice: voice || null,
      speed,
      hits: cacheHits,
      misses: cacheMisses,
    });
    return;
  }

  logLine("INFO", "tts cache MISS — synthesizing", {
    rid: req._rid,
    provider: provider.id,
    lang,
    chars: text.length,
    voice: voice || null,
    speed,
  });

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
    logLine("INFO", "tts synthesized", {
      rid: req._rid,
      provider: provider.id,
      lang,
      chars: text.length,
      bytes: totalBytes,
      hits: cacheHits,
      misses: cacheMisses,
      charsUsed,
    });
  } catch (err) {
    // Structured error log — the Vercel dashboard surfaces this in
    // the Function Logs panel. We include everything you'd want to
    // diagnose a flaky upstream without reproducing it.
    logLine("ERROR", "tts provider failure", {
      rid: req._rid,
      provider: provider.id,
      lang,
      chars: text.length,
      voice: voice || null,
      speed,
      upstream_status: err.status || null,
      message: err.message,
      upstream_body: err.body ? String(err.body).slice(0, 500) : null,
      stack: err.stack ? String(err.stack).split("\n").slice(0, 5).join(" | ") : null,
    });
    res.status(err.status || 502).json({
      error: "tts provider failure",
      provider: provider.id,
      detail: err.message,
      request_id: req._rid,
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

// Last-resort error handler. Express invokes this with err when a
// route or middleware throws synchronously, or when next(err) is
// called. Without this, such errors become generic 500s with no
// log line, which is exactly the situation that prompted the
// "Cannot find module './server/cache'" mystery.
app.use((err, req, res, _next) => {
  logLine("ERROR", "unhandled", {
    rid: req._rid,
    method: req.method,
    path: req.originalUrl || req.url,
    message: err && err.message,
    code: err && err.code,
    stack: err && err.stack ? String(err.stack).split("\n").slice(0, 8).join(" | ") : null,
  });
  if (res.headersSent) return;
  res.status(500).json({
    error: "internal server error",
    request_id: req._rid,
  });
});

// Top-level guard: any uncaught exception (including async ones
// that escape route handlers) gets logged with stack + request
// context where available.
process.on("uncaughtException", (err) => {
  logLine("ERROR", "uncaughtException", {
    message: err && err.message,
    stack: err && err.stack ? String(err.stack).split("\n").slice(0, 8).join(" | ") : null,
  });
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logLine("ERROR", "unhandledRejection", {
    message: err.message,
    stack: err.stack ? String(err.stack).split("\n").slice(0, 8).join(" | ") : null,
  });
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
    logLine("INFO", "proxy listening", {
      url: `http://localhost:${PORT}`,
      default_provider: defaultId(),
      cache_strategy: cache.stats().strategy,
    });
    if (defaultId() === "elevenlabs" && !process.env.ELEVENLABS_API_KEY) {
      logLine("WARN", "ELEVENLABS_API_KEY not set — /api/tts will return 500");
    }
  });
}

module.exports = app;
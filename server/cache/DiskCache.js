// DiskCache.js — file-based cache strategy (the original behavior).
//
// Stores entries as <provider>/<lang>/<key>.bin + <key>.json under
// the configured cache root. Lazy LRU eviction kicks in when the
// total directory size exceeds MAX_BYTES. Implements the common
// strategy interface documented in cache/index.js.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Cache lives outside the source tree so it doesn't pollute the repo
// or get shipped with deployments. Override with TTS_CACHE_ROOT.
//
// On serverless platforms (Vercel, AWS Lambda) the project root is
// read-only — we MUST write to /tmp instead. Detect via the VERCEL
// env var Vercel sets on every deployment.
//
// IMPORTANT: we resolve this lazily (inside a getter) rather than
// at require-time. Vercel injects VERCEL very early, but if it's
// missing at module-init we used to fall through to a read-only
// project path and throw EROFS, killing the whole serverless
// function. Lazy resolution + a guarded mkdir keeps the module
// importable even when /tmp isn't yet visible.
function resolveCacheRoot() {
  if (process.env.TTS_CACHE_ROOT) {
    return path.resolve(process.env.TTS_CACHE_ROOT);
  }
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join("/tmp", "language-learning-tts-cache");
  }
  return path.join(__dirname, "..", "..", ".cache");
}

const MAX_BYTES = Number(process.env.TTS_CACHE_MAX_BYTES) || 200 * 1024 * 1024;

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
    return true;
  } catch (e) {
    // Read-only filesystem (Vercel deployment FS, or some sandboxes).
    // We deliberately swallow this — callers will see has()/get()
    // returning empty, which is exactly what a no-op cache looks
    // like. The function stays alive and serves uncached requests.
    return false;
  }
}

function normLang(lang) {
  return String(lang || "").toLowerCase() || "unknown";
}

// Resolve on-disk paths for a given key. Returns { bin, meta, dir }.
function pathsFor({ provider, lang, key }) {
  const dir = path.join(resolveCacheRoot(), provider, normLang(lang));
  return {
    dir,
    bin: path.join(dir, key + ".bin"),
    meta: path.join(dir, key + ".json"),
  };
}

// Walks the cache tree and returns total byte size.
function dirSize(dir) {
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
          try { total += fs.statSync(p).size; } catch (e) { /* ignore */ }
        }
      }
    }
  } catch (e) { /* ignore */ }
  return total;
}

// Evict oldest entries (by atime) until the dir is under the cap.
// .bin/.json pairs are deleted together so we don't leave orphans.
function evictUntilUnder(dir, capBytes) {
  let total = dirSize(dir);
  if (total <= capBytes) return;
  const entries = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let list;
    try { list = fs.readdirSync(cur, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const e of list) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith(".bin")) {
        try {
          const st = fs.statSync(p);
          entries.push({ path: p, atime: st.atimeMs, size: st.size });
        } catch (e) { /* ignore */ }
      }
    }
  }
  entries.sort((a, b) => a.atime - b.atime);
  for (const e of entries) {
    if (total <= capBytes) break;
    try {
      fs.unlinkSync(e.path);
      const metaPath = e.path.replace(/\.bin$/, ".json");
      try { fs.unlinkSync(metaPath); } catch (e2) { /* ignore */ }
      total -= e.size;
    } catch (e) { /* ignore */ }
  }
}

class DiskCache {
  constructor() {
    // Intentionally NO fs work here. The constructor must stay
    // side-effect free so that simply requiring the module (e.g.
    // when Vercel's bundler or file-tracer loads it for static
    // analysis) never touches the filesystem. We do the
    // existence-check lazily on first use.
    this._rootEnsured = false;
    this._disabled = false;
  }

  // Lazily create the cache root on first use. Returns true on
  // success, false on a read-only filesystem (in which case the
  // cache is disabled for the rest of the process lifetime).
  _ensureRootOnce() {
    if (this._rootEnsured) return !this._disabled;
    this._rootEnsured = true;
    const root = resolveCacheRoot();
    const ok = ensureDir(root);
    if (!ok) {
      console.warn(
        `[tts] DiskCache: could not create ${root}; cache disabled. ` +
        `Falling back to uncached TTS. Set TTS_CACHE_STRATEGY=memory ` +
        `if disk writes are unreliable in this environment.`
      );
      this._disabled = true;
      return false;
    }
    return true;
  }

  // Cheap existence check; no IO beyond stat.
  has({ provider, lang, key }) {
    if (this._disabled || !this._ensureRootOnce()) return false;
    const p = pathsFor({ provider, lang, key });
    try {
      return fs.statSync(p.bin).isFile();
    } catch (e) {
      return false;
    }
  }

  // Read a cached mp3 back as a Node Readable + its content type.
  // Returns null on miss. Bumps atime so the entry counts as
  // recently-used.
  get({ provider, lang, key }) {
    if (this._disabled || !this._ensureRootOnce()) return null;
    const p = pathsFor({ provider, lang, key });
    if (!this.has({ provider, lang, key })) return null;
    try {
      fs.utimesSync(p.bin, new Date(), new Date());
      const metaRaw = fs.readFileSync(p.meta, "utf8");
      const meta = JSON.parse(metaRaw);
      const stream = fs.createReadStream(p.bin);
      return { stream, meta };
    } catch (e) {
      return null;
    }
  }

  // Buffer the provider's stream and persist to disk. Safe to fail:
  // we still return the original stream in the error case so the
  // caller can serve the response anyway.
  async set({ provider, lang, key, meta, sourceStream }) {
    if (this._disabled || !this._ensureRootOnce()) {
      // Drain the stream so the caller doesn't see backpressure.
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
      } catch (e) { /* ignore */ }
      return { bytes: 0, cached: false, error: "disk cache disabled" };
    }
    const p = pathsFor({ provider, lang, key });
    ensureDir(p.dir);
    const tmpBin = p.bin + ".tmp";

    const chunks = [];
    let totalBytes = 0;
    const reader =
      typeof sourceStream.getReader === "function"
        ? sourceStream.getReader()
        : null;

    try {
      if (reader) {
        // Web ReadableStream path (fetch body).
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          totalBytes += value.byteLength;
        }
      } else {
        // Node Readable path (Buffer.from(...) wrapped in Readable.from).
        for await (const chunk of sourceStream) {
          chunks.push(Buffer.from(chunk));
          totalBytes += chunk.length;
        }
      }

      const buf = Buffer.concat(chunks, totalBytes);
      fs.writeFileSync(tmpBin, buf);
      fs.renameSync(tmpBin, p.bin);
      fs.writeFileSync(p.meta, JSON.stringify({ ...meta, bytes: totalBytes }));

      // Lazy eviction sweep — only runs if we're past the cap.
      if (dirSize(resolveCacheRoot()) > MAX_BYTES) {
        evictUntilUnder(resolveCacheRoot(), MAX_BYTES);
      }
      return { bytes: totalBytes, cached: true };
    } catch (e) {
      // Best-effort cleanup.
      try { fs.unlinkSync(tmpBin); } catch (e2) { /* ignore */ }
      return { bytes: 0, cached: false, error: e.message };
    }
  }

  // Remove a single entry (.bin + .json pair).
  delete({ provider, lang, key }) {
    if (this._disabled || !this._ensureRootOnce()) return false;
    const p = pathsFor({ provider, lang, key });
    let removed = false;
    try { fs.unlinkSync(p.bin); removed = true; } catch (e) { /* ignore */ }
    try { fs.unlinkSync(p.meta); } catch (e) { /* ignore */ }
    return removed;
  }

  // Empty the entire cache directory.
  clear() {
    if (this._disabled || !this._ensureRootOnce()) return false;
    const root = resolveCacheRoot();
    try {
      fs.rmSync(root, { recursive: true, force: true });
      ensureDir(root);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Stats for /health and debugging.
  stats() {
    const root = resolveCacheRoot();
    return {
      bytes: dirSize(root),
      maxBytes: MAX_BYTES,
      root,
      strategy: "disk",
    };
  }
}

module.exports = DiskCache;

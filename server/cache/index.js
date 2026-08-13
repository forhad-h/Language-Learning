// cache/index.js — Cache strategy registry + factory.
//
// Common interface (every strategy must implement these):
//   has({ provider, lang, key }) → boolean
//   get({ provider, lang, key }) → { stream, meta } | null
//   set({ provider, lang, key, meta, sourceStream, ttlMs? })
//        → { bytes, cached, error? }   (async)
//   delete({ provider, lang, key })  → boolean
//   clear()                          → boolean
//   stats()                          → { ... }
//
// `makeKey()` is a pure helper that lives at module level — it
// doesn't belong to any single strategy.
//
// ---------------------------------------------------------------------------
// To add a new cache strategy (e.g. Redis, S3, Memcached):
//   1. Create server/cache/RedisCache.js (or similar) that exports a
//      class implementing the interface above.
//   2. Require it in the STRATEGIES map below.
//   3. Pick it at runtime via createCache('redis') or set
//      TTS_CACHE_STRATEGY=redis in .env.
// ---------------------------------------------------------------------------

"use strict";

const crypto = require("node:crypto");

const DiskCache = require("./DiskCache");
const MemoryCache = require("./MemoryCache");

const STRATEGIES = {
  disk: DiskCache,
  memory: MemoryCache,
};

// Build a stable hash key from the synthesis parameters. Provider is
// part of the key so swapping providers doesn't accidentally hit an
// old ElevenLabs mp3 for a different provider's request.
function makeKey({ provider, lang, text, voice, speed }) {
  const norm = (v) => (v == null ? "" : String(v));
  const material = [
    provider,
    norm(lang).toLowerCase(),
    text.trim(),
    norm(voice),
    norm(speed),
  ].join("\u0001");
  return crypto.createHash("sha256").update(material).digest("hex");
}

// Factory: pick a strategy by name.
//
// Default selection rules:
//   1. Explicit TTS_CACHE_STRATEGY env var wins (e.g. "memory", "disk").
//   2. On Vercel (or any serverless platform where /tmp is
//      ephemeral and the bundle FS is read-only), default to
//      "memory". The in-memory cache skips the disk entirely, so
//      it can never trigger an EROFS or a cold-start crash.
//   3. Otherwise default to "disk" for the original behavior.
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
  const Strategy = STRATEGIES[name];
  if (!Strategy) {
    throw new Error(
      `unknown cache strategy "${name}". Known: ${Object.keys(STRATEGIES).join(", ")}`
    );
  }
  return new Strategy();
}

// Default singleton — keeps the call sites in server.js short.
const defaultCache = createCache();

module.exports = {
  createCache,
  makeKey,
  // Re-export the default instance's methods so server.js can keep
  // calling cache.getStream / cache.put as before.
  has: defaultCache.has.bind(defaultCache),
  get: defaultCache.get.bind(defaultCache),
  set: defaultCache.set.bind(defaultCache),
  delete: defaultCache.delete.bind(defaultCache),
  clear: defaultCache.clear.bind(defaultCache),
  stats: defaultCache.stats.bind(defaultCache),
  STRATEGIES: Object.keys(STRATEGIES),
};

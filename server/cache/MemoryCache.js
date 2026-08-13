// MemoryCache.js — in-memory cache strategy (Map with TTL).
//
// Useful for dev/test, or when you want to skip disk IO entirely.
// Entries live in a Map; each carries an optional expiresAt timestamp.
// Implements the same common strategy interface as DiskCache, so the
// rest of the codebase doesn't care which backend is in use.
//
// Note: nothing here is persisted — a process restart wipes the cache.

"use strict";

const { Readable } = require("node:stream");

class MemoryCache {
  constructor() {
    this.store = new Map(); // key string → { buffer, meta, expiresAt }
  }

  // Build the internal key from the strategy's compound tuple.
  // Each strategy is free to key however it likes; the rest of the
  // app passes the same { provider, lang, key } triple.
  _k({ provider, lang, key }) {
    return `${provider}::${String(lang || "").toLowerCase()}::${key}`;
  }

  has({ provider, lang, key }) {
    const k = this._k({ provider, lang, key });
    const entry = this.store.get(k);
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(k);
      return false;
    }
    return true;
  }

  // Returns { stream, meta } or null. Wraps the Buffer in a fresh
  // Readable each call so the caller can consume it independently.
  get({ provider, lang, key }) {
    const k = this._k({ provider, lang, key });
    const entry = this.store.get(k);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(k);
      return null;
    }
    // Refresh recency so callers that care about LRU-ish behavior
    // get it (even though we don't actually evict).
    this.store.delete(k);
    this.store.set(k, entry);
    return {
      stream: Readable.from(entry.buffer),
      meta: entry.meta,
    };
  }

  async set({ provider, lang, key, meta, sourceStream, ttlMs }) {
    const k = this._k({ provider, lang, key });
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
      const expiresAt = ttlMs ? Date.now() + ttlMs : null;
      this.store.set(k, {
        buffer: buf,
        meta: { ...meta, bytes: totalBytes },
        expiresAt,
      });
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
    return {
      bytes,
      entries: this.store.size,
      strategy: "memory",
    };
  }
}

module.exports = MemoryCache;

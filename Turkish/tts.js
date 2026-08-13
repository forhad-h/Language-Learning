/* tts.js — Frontend TTS client (provider-agnostic).
 *
 * Responsibilities split:
 *   - this file: shared infrastructure
 *       · singleton <audio> element (overlap-safe)
 *       · localStorage cache under lc-tts:<text> with a 2 MB soft cap
 *       · button state transitions (idle/loading/playing/error)
 *   - providers.js: per-provider speak(text, btn) implementations
 *
 * Public entry:
 *   window.LC_speakSentence(lang, text, btn)
 *
 * The provider is resolved at click time via window.LC_TTS_PROVIDERS,
 * so swapping providers is a one-call runtime change:
 *   window.LC_TTS_PROVIDERS.setActive('webspeech')
 *
 * Default server-side provider: ElevenLabs. WebSpeech is always
 * available as a browser-native fallback regardless of the
 * server's TTS_PROVIDER env var.
 */

(function () {
  "use strict";

  if (!window.LC_TTS_PROVIDERS) {
    console.error("[tts] providers.js must load before tts.js");
    return;
  }

  var LS_PREFIX = "lc-tts:";
  var MAX_CACHE_BYTES = 2 * 1024 * 1024;

  // ---- Singleton <audio> ---------------------------------------------
  var audio = null;
  function getAudio() {
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
    }
    return audio;
  }

  // ---- Cache (localStorage, base64-blob encoding) -------------------
  function ab2b64(buf) {
    var bytes = new Uint8Array(buf);
    var chunks = [];
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      chunks.push(String.fromCharCode.apply(
        null, bytes.subarray(i, i + CHUNK)
      ));
    }
    return btoa(chunks.join(""));
  }
  function b642ab(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {
      evictOldest();
      try { window.localStorage.setItem(key, value); } catch (e2) { /* give up */ }
    }
  }
  function lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function cacheBytes() {
    var total = 0;
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) {
          total += (window.localStorage.getItem(k) || "").length * 2;
        }
      }
    } catch (e) { /* ignore */ }
    return total;
  }
  function evictOldest() {
    // localStorage has no real ordering, so this picks arbitrarily;
    // good enough for a soft cap.
    try {
      var first = null;
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) { first = k; break; }
      }
      if (first) lsRemove(first);
    } catch (e) { /* ignore */ }
  }

  var cache = {
    // Cache key includes the speed so changing the speed naturally
    // re-fetches rather than replaying the wrong cadence. Most users
    // keep one speed and reuse cached audio; users who experiment
    // with speed get a small per-speed copy.
    key: function (text, speed) {
      var s = speed == null ? 0.5 : speed;
      return LS_PREFIX + s.toFixed(2) + ":" + text;
    },
    get: function (key) {
      var b64 = lsGet(key);
      if (!b64) return null;
      try { return new Blob([b642ab(b64)], { type: "audio/mpeg" }); }
      catch (e) { lsRemove(key); return null; }
    },
    set: function (key, blob) {
      // Read the blob back into an ArrayBuffer, then base64. We
      // could store blobs directly via indexedDB, but localStorage
      // works in every browser and the cache size is bounded.
      blob.arrayBuffer().then(function (buf) {
        if (cacheBytes() >= MAX_CACHE_BYTES) evictOldest();
        lsSet(key, ab2b64(buf));
      }).catch(function () { /* ignore */ });
    },
  };

  // ---- Button state helpers ------------------------------------------
  function setBtnState(btn, state, label) {
    if (!btn) return;
    if (state) btn.setAttribute("data-tts-state", state);
    else btn.removeAttribute("data-tts-state");
    if (label) {
      // The button uses an inline SVG icon followed by a label span;
      // update only the label so the icon stays in place.
      var labelEl = btn.querySelector(".lc-icon-label");
      if (labelEl) labelEl.textContent = label;
      else btn.textContent = label;
    }
  }

  // ---- Playback (shared by all server-backed providers) --------------
  function playBlob(blob, btn) {
    var a = getAudio();
    if (!a.paused) {
      a.pause();
      try { a.currentTime = 0; } catch (e) { /* ignore */ }
    }
    var url = URL.createObjectURL(blob);
    a.src = url;
    setBtnState(btn, "playing", "🔊 Playing…");
    return a.play().then(function () {
      return new Promise(function (resolve) {
        var done = function () {
          a.removeEventListener("ended", done);
          a.removeEventListener("error", done);
          setBtnState(btn, "", "🔊 Listen");
          resolve();
        };
        a.addEventListener("ended", done);
        a.addEventListener("error", done);
      });
    }).catch(function () {
      setBtnState(btn, "", "🔊 Listen");
      return Promise.resolve();
    }).finally(function () {
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    });
  }

  // ---- Public entry point --------------------------------------------
  function LC_speakSentence(lang, text, btn) {
    text = (text || "").trim();
    if (!text) return;
    var provider = window.LC_TTS_PROVIDERS.pick(lang);
    if (!provider) return;

    // Cache is only useful for providers that produce audio bytes.
    // Web Speech handles its own re-speak cheaply, so skip the cache.
    var useCache = provider.id !== "webspeech";

    var promise;
    if (useCache) {
      var hit = cache.get(cache.key(text));
      if (hit) {
        promise = playBlob(hit, btn);
      } else {
        setBtnState(btn, "loading", "Loading");
        promise = provider.speak({
          text: text,
          lang: lang,
          btn: btn,
          cache: cache,
          playUrl: playBlob,
          setBtn: setBtnState,
        });
      }
    } else {
      promise = provider.speak({
        text: text,
        lang: lang,
        btn: btn,
        setBtn: setBtnState,
      });
    }

    Promise.resolve(promise).catch(function (err) {
      console.warn("[tts] speak failed via " + provider.id, err);
      setBtnState(btn, "error", "⚠ retry");
      setTimeout(function () { setBtnState(btn, "", "🔊 Listen"); }, 2500);
    });
  }

  // Expose for app.js's sentence speaker button. Backwards-compatible:
  // if a caller still passes only (text, btn), default to lang "tr".
  window.LC_speakTurkishSentence = function (text, btn) {
    LC_speakSentence("tr", text, btn);
  };
  window.LC_speakSentence = LC_speakSentence;

  // Speed knob. Providers read from here on every click. Persists in
  // localStorage so the chosen cadence survives reloads.
  var LS_SPEED = "lc-tts-speed";
  function getStoredSpeed() {
    try {
      var v = window.localStorage.getItem(LS_SPEED);
      var n = v == null ? NaN : Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch (e) { return null; }
  }
  // Initialize window.LC_TTS_SPEED from stored preference if not
  // already set. providers.js reads it lazily, so a deferred init is
  // fine.
  if (typeof window.LC_TTS_SPEED !== "number") {
    var stored = getStoredSpeed();
    window.LC_TTS_SPEED = stored != null ? stored : 0.5;
  }
  window.LC_setTtsSpeed = function (speed) {
    var n = Number(speed);
    if (!Number.isFinite(n) || n <= 0) return;
    window.LC_TTS_SPEED = Math.max(0.25, Math.min(2.0, n));
    try { window.localStorage.setItem(LS_SPEED, String(window.LC_TTS_SPEED)); }
    catch (e) { /* ignore */ }
  };
})();
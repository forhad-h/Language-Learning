/* providers.js — Frontend TTS provider registry.
 *
 * Each provider implements:
 *   id        — string
 *   label     — string (for UI)
 *   supports  — function(langCode) → boolean
 *   speak     — async ({ text, lang, btn, cache, playUrl, setBtn, speed }) → Promise
 *
 * The shared client (see tts.js) handles:
 *   - the singleton <audio> element
 *   - localStorage caching keyed by (text, speed) so speed changes
 *     naturally bust the cache
 *   - button state transitions (idle/loading/playing/error)
 *
 * Provider authors only have to worry about: "how do I turn this text
 * into something the user hears?" They are free to:
 *   - hit the server proxy via fetch() and pass the result to playUrl(blob, btn)
 *   - hand off to a client-side API like window.speechSynthesis directly
 *
 * Currently registered:
 *   - ElevenLabs (default; hits /api/tts, returns audio/mpeg)
 *   - WebSpeech  (browser-native speechSynthesis; works offline)
 *
 * Speed:
 *   The active speed (a multiplier, 0.5–1.0 typically) lives at
 *   window.LC_TTS_SPEED. The ElevenLabs provider passes it in the POST
 *   body; the WebSpeech provider applies it to utterance.rate. The
 *   shared client includes it in cache keys so changing the slider
 *   re-fetches instead of replaying the wrong audio.
 */

(function () {
  "use strict";

  function currentSpeed() {
    // Default 0.8 — learner-friendly. window.LC_TTS_SPEED can be set
    // by the toolbar slider, in DevTools, or by future per-lesson
    // config.
    var s = (typeof window !== "undefined" && window.LC_TTS_SPEED);
    return typeof s === "number" && s > 0 ? s : 0.8;
  }

  function proxyPost(args) {
    var setBtn = args.setBtn;
    var playUrl = args.playUrl;
    var btn = args.btn;
    var proxyUrl = args.proxyUrl || "/api/tts";
    var speed = currentSpeed();

    setBtn(btn, "loading", "⏳");
    return fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: args.text,
        lang: args.lang || "tr",
        speed: speed,
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      // The server returns audio/mpeg for ElevenLabs, but a JSON
      // directive if WebSpeech was selected. Honor the actual content
      // type so the client can route WebSpeech payloads to
      // speechSynthesis instead of an <audio> element.
      var ct = res.headers.get("Content-Type") || "";
      if (ct.indexOf("application/json") === 0) {
        return res.json().then(function (j) { return { json: j }; });
      }
      return res.arrayBuffer().then(function (buf) {
        var blob = new Blob([buf], { type: "audio/mpeg" });
        return { blob: blob };
      });
    });
  }

  // ---- Provider: ElevenLabs (via /api/tts proxy) -----------------------
  // Default. Free tier, no credit card, best naturalness for Turkish.
  var elevenlabsProvider = {
    id: "elevenlabs",
    label: "ElevenLabs (via proxy)",
    supports: function (lang) { return lang === "tr"; },
    speak: function (args) {
      var text = args.text;
      var btn = args.btn;
      var cache = args.cache;
      var playUrl = args.playUrl;

      var key = cache.key(text, currentSpeed());
      var hit = cache.get(key);
      if (hit) return playUrl(hit, btn);

      return proxyPost(args).then(function (out) {
        if (out.json) {
          // Unexpected — ElevenLabs shouldn't return JSON.
          throw new Error("elevenlabs returned JSON directive");
        }
        try { cache.set(key, out.blob); } catch (e) { /* quota, ignore */ }
        return playUrl(out.blob, btn);
      });
    },
  };

  // ---- Provider: Browser Web Speech API (no server) -------------------
  // Uses window.speechSynthesis. Free, offline, but quality depends on
  // the OS. Good fallback / dev fallback when the proxy is down.
  // Skips the persistent browser cache — speechSynthesis doesn't
  // produce audio bytes to persist, and re-synthesizing is essentially
  // free locally. The server cache is also bypassed for this provider
  // since there's no synthesis cost to amortize.
  var webspeechProvider = {
    id: "webspeech",
    label: "Browser Web Speech API",
    supports: function (lang) {
      return lang === "tr" || lang === "en" || lang === "bn";
    },
    speak: function (args) {
      var text = args.text;
      var btn = args.btn;
      var setBtn = args.setBtn;
      if (typeof window === "undefined" || !window.speechSynthesis) {
        throw new Error("speechSynthesis not available in this browser");
      }
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = mapLangToBcp47(args.lang || "tr");
      u.rate = currentSpeed(); // Web Speech's native speed control
      var voices = window.speechSynthesis.getVoices() || [];
      var match = voices.find(function (v) { return v.lang === u.lang; })
                || voices.find(function (v) { return v.lang.indexOf(u.lang.slice(0, 2)) === 0; });
      if (match) u.voice = match;
      u.onstart = function () { setBtn(btn, "playing", "🔊 Playing…"); };
      u.onend = function () { setBtn(btn, "", "🔊 Listen"); };
      u.onerror = function () { setBtn(btn, "", "🔊 Listen"); };
      window.speechSynthesis.speak(u);
      return Promise.resolve();
    },
  };

  function mapLangToBcp47(code) {
    var map = { tr: "tr-TR", en: "en-US", bn: "bn-IN" };
    return map[code] || code;
  }

  // ---- Registry -------------------------------------------------------
  var providers = [elevenlabsProvider, webspeechProvider];

  function byId(id) { return providers.find(function (p) { return p.id === id; }); }

  var activeId = (typeof window !== "undefined" && window.LC_TTS_PROVIDER) || "elevenlabs";

  function pick(lang, preferredId) {
    var id = preferredId || activeId;
    if (id) {
      var p = byId(id);
      if (p && p.supports(lang)) return p;
    }
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].supports(lang)) return providers[i];
    }
    return webspeechProvider;
  }

  function list() {
    return providers.map(function (p) { return { id: p.id, label: p.label }; });
  }

  function setActive(id) {
    if (byId(id)) activeId = id;
  }

  window.LC_TTS_PROVIDERS = {
    list: list,
    pick: pick,
    setActive: setActive,
    get activeId() { return activeId; },
    getSpeed: currentSpeed,
  };
})();
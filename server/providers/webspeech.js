// providers/webspeech.js — Browser Web Speech API shim.
//
// The Web Speech API runs entirely in the user's browser via
// speechSynthesis. There is no server call to proxy. This provider
// exists so the frontend can have a single uniform "speak" call site
// whether the backend is ElevenLabs or no backend at all.
//
// The strategy doesn't strictly need a server roundtrip — when this
// provider is selected server-side, /api/tts returns a small JSON
// hint telling the client to use the browser's speechSynthesis
// directly. The proxy stays uniform: it always returns *something*
// (audio bytes OR a JSON directive).
//
// Body returned by synthesize():
//   { __clientSide: true, lang, voice? }
//
// Frontend knows: if blob.type starts with "application/json" with this
// marker, hand off to window.speechSynthesis instead of <audio>.

"use strict";

module.exports = {
  id: "webspeech",
  label: "Browser Web Speech API (no server call)",

  supports(lang) {
    // The browser decides what's actually available. We optimistically
    // claim all the language codes the project teaches.
    return lang === "tr" || lang === "en" || lang === "bn";
  },

  // WebSpeech has no server-side default voice — the browser picks
  // from installed voices. Returning empty keeps cache keys stable
  // across requests that don't specify a voice.
  defaultVoiceFor() {
    return "";
  },

  async synthesize({ text, lang, voice, speed }) {
    // Encode as a tiny JSON stream. The frontend's tts.js knows to
    // route this through window.speechSynthesis instead of <audio>.
    // `speed` defaults to 0.8 on the frontend if missing.
    const payload = JSON.stringify({
      __clientSide: true,
      provider: "webspeech",
      lang,
      voice: voice || null,
      speed: typeof speed === "number" ? speed : null,
      text,
    });
    const { Readable } = require("node:stream");
    return Readable.from(Buffer.from(payload, "utf8"));
  },
};

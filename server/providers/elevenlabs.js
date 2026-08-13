// providers/elevenlabs.js — ElevenLabs TTS provider.
//
// Contract every provider must satisfy:
//   id           — short string ("elevenlabs")
//   label        — display name
//   supports     — function(langCode) → boolean
//   synthesize   — async ({ text, lang, voice?, speed? }) → web ReadableStream
//                  of the audio bytes (mp3 by default). Throws an
//                  Error with .status and .body for HTTP-style errors.
//
// ElevenLabs specifics:
//   - Free tier: 10k chars/month without a credit card.
//   - Multilingual model "eleven_multilingual_v2" handles Turkish well.
//   - API returns audio/mpeg by default.
//   - No native `speed` parameter (as of the multilingual_v2 model).
//     We slow the cadence by inserting <break time="..."/> tags which
//     ElevenLabs' SSML-lite parser does honor. This is a real but
//     modest effect (~10–20% slower at speed=0.7).
//
// Env:
//   ELEVENLABS_API_KEY   required
//   ELEVENLABS_VOICE_ID  optional, defaults to Clyde (deep male)

"use strict";

// ElevenLabs' built-in voice IDs are tied to the account that
// created them. "Rachel" (21m00Tcm4TlvDq8ikWAM) ships with every
// ElevenLabs account, so it's the safest default — the previous
// default ("b0e9dk46J60vl9FwM1sF") was returning 404 on production
// because it was account-specific. Override with ELEVENLABS_VOICE_ID
// in env to use any other voice you own.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — multilingual v2
const MODEL_ID = "eleven_multilingual_v2";

// Slow down the voice by inserting SSML-like <break> tags between
// words. speed is a multiplier: 1.0 = no change, 0.7 = ~30% slower
// cadence. We don't try to make it faster than 1.0 because stretching
// already-natural speech feels artificial.
function applySpeed(text, speed) {
  if (!text || !speed || speed >= 1.0) return text;
  // Map 0.5–1.0 → 250–0 ms pause per word
  const clamped = Math.max(0.5, Math.min(1.0, speed));
  const ms = Math.round((1 - clamped) * 500); // 0.5 → 250ms, 1.0 → 0ms
  if (ms <= 0) return text;
  // Break between every word. ElevenLabs accepts the <break time="Xms"/>
  // tag in its multilingual model.
  const breakTag = `<break time="${ms}ms"/>`;
  return text.split(/\s+/).join(" " + breakTag + " ");
}

module.exports = {
  id: "elevenlabs",
  label: "ElevenLabs",

  supports(lang) {
    return lang === "tr";
  },

  // Returns the effective voice id the server would use when the
  // request doesn't specify one. Used by the cache key so cached
  // entries stay stable across requests that omit the voice field.
  defaultVoiceFor(lang) {
    return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  },

  async synthesize({ text, lang, voice, speed }) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      const err = new Error("ELEVENLABS_API_KEY not set on server");
      err.status = 500;
      throw err;
    }

    const voiceId = voice || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: applySpeed(text, speed),
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      const err = new Error(
        `elevenlabs upstream ${upstream.status} ` +
        `(voice_id=${voiceId}, model=${MODEL_ID})`
      );
      err.status = upstream.status;
      err.body = body.slice(0, 500);
      throw err;
    }

    return upstream.body;
  },
};

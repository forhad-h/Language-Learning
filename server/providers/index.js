// providers/index.js — Provider registry.
//
// To add a new server-side provider:
//   1. Create server/providers/<id>.js exporting
//      { id, label, supports(lang), defaultVoiceFor(lang), synthesize({...}) }.
//   2. require() it below and add it to the `providers` array.
//   3. (Optional) Make the default switchable via TTS_PROVIDER in .env.
//
// The provider list is currently [elevenlabs, webspeech]. ElevenLabs is
// the only one that hits the network. Everything else (Google, Azure, etc.)
// has been removed to keep the project focused on a single, free-tier
// friendly backend.

"use strict";

const elevenlabs = require("./elevenlabs");
const webspeech = require("./webspeech");

// Order matters: the first provider in this array that `supports(lang)`
// becomes the default fallback. Keep ElevenLabs first.
const providers = [elevenlabs, webspeech];

function byId(id) {
  return providers.find((p) => p.id === id);
}

function pick(lang, preferredId) {
  if (preferredId) {
    const p = byId(preferredId);
    if (p && p.supports(lang)) return p;
  }
  for (const p of providers) {
    if (p.supports(lang)) return p;
  }
  // Defensive: webspeech claims all project languages, so this branch
  // should never run in practice.
  return webspeech;
}

function defaultId() {
  // Only honor TTS_PROVIDER if it's a registered id; otherwise fall
  // back to ElevenLabs.
  const envId = process.env.TTS_PROVIDER;
  if (envId && byId(envId)) return envId;
  return elevenlabs.id;
}

module.exports = {
  providers,
  byId,
  pick,
  defaultId,
};
// api/index.js — Vercel serverless entry point.
//
// Vercel treats every file under /api as a serverless function. We
// want ONE function that handles ALL backend routes (/api/tts,
// /api/providers, /health). The frontend is served separately by
// Vercel's static-file handling — see vercel.json.
//
// We delegate straight to the Express app used in local dev, so the
// two boot paths stay in lock-step.

"use strict";

// Force the server to take the serverless branch (skip app.listen).
// The server module reads process.env.VERCEL to decide; we set it
// here defensively in case Vercel's own injection is delayed.
if (!process.env.VERCEL) process.env.VERCEL = "1";

const app = require("../server.js");

// Vercel's Node runtime supports the classic (req, res) signature
// directly — no Web Streams adapter needed. Just export the app.
module.exports = app;
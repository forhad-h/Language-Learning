# Language Cards

A small static language-learning playground. Lessons pair a source language with a target translation, render word-level alignments, and let you focus on individual phrases to dim the rest of the sentence.

## Layout

```
.
├── index.html                       # entry + landing page shell
├── app.js                           # generic renderer + hash router
├── styles.css
├── <Language>/                      # one folder per language
│   └── lessons/
│       └── <lesson-id>.js           # self-registers via
│                                    #   window.LC_LESSONS.push(...)
├── test-e2e.js                      # popup-reuse Playwright test
├── test-headless-new.js
└── package.json
```

## Add a new lesson

1. Drop `<Language>/lessons/<id>.js` with a `window.LC_LESSONS.push({...})` entry. See `Turkish/lessons/yapmak-etmek.js` for the schema (`language`, `path`, `title`, `cards`, `translate`, …).
2. Add `<script src="<Language>/lessons/<id>.js"></script>` to `index.html` after the existing lesson scripts.

## URL structure (GitHub Pages)

- `/` — landing page listing every language and lesson.
- `/#/<language>/<lesson-id>` — deep link into a lesson (e.g. `/#/turkish/yapmak-etmek`).

Hash routes are used so the site works as pure static files with no server-side routing.

## Local development

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

```
node test-e2e.js
```

Requires `node_modules/playwright` (already vendored via `npm install`).
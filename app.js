/* app.js — Generic renderer for language-learning cards.
 *
 * Concerns handled here:
 *   1. Lesson registry (read window.LC_LESSONS, build sidebar/select,
 *      persist active lesson, switch on user input).
 *   2. Generic card rendering — palette slots, phrase tokens,
 *      cross-highlighting, per-lesson sentence-level translate
 *      affordance.
 *   3. Display controls (font size, plain text) wired to the
 *      bottom-center toolbar; choices persist in localStorage.
 *
 * Lesson data (cards, sentences, translate config) lives in
 * <Language>/lessons/*.js. No language-specific code lives in
 * this file.
 *
 * Each card is a self-contained <article> with its own phrase
 * tokens. Phrase groups share a stable data-pair id so that
 * hovering or focusing a phrase anywhere on the page highlights
 * every phrase that carries the same id (and dims the rest of
 * that line). All phrase fragments are inserted with textContent;
 * HTML in lesson data is never evaluated. Per-element lang and
 * dir come from the lesson locale, so any language pair renders
 * correctly without code changes.
 */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     Section A — Lesson registry
     --------------------------------------------------------- */

  var lessons = Array.isArray(window.LC_LESSONS) ? window.LC_LESSONS : [];
  var LS_ACTIVE = "lc-active-lesson";

  function getActiveLessonId() {
    var stored = null;
    try { stored = window.localStorage.getItem(LS_ACTIVE); } catch (e) {}
    if (stored && lessons.some(function (l) { return l.id === stored; })) {
      return stored;
    }
    return lessons[0] ? lessons[0].id : null;
  }

  function setActiveLesson(id) {
    if (!lessons.some(function (l) { return l.id === id; })) return;
    try { window.localStorage.setItem(LS_ACTIVE, id); } catch (e) {}
    document.body.setAttribute("data-active-lesson", id);
    renderRegistry(id);
    renderActiveLesson();
  }

  function renderRegistry(activeId) {
    var list = document.querySelector("[data-lesson-list]");
    if (!list) return;
    list.innerHTML = "";
    lessons.forEach(function (lesson) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lesson-item";
      btn.setAttribute("data-lesson-id", lesson.id);
      btn.textContent = lesson.short || lesson.title || lesson.id;
      btn.title = lesson.title || lesson.id;
      if (lesson.id === activeId) {
        btn.setAttribute("aria-current", "page");
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", function () {
        setActiveLesson(lesson.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });

    var select = document.querySelector("[data-lesson-select]");
    if (select) {
      select.innerHTML = "";
      lessons.forEach(function (lesson) {
        var opt = document.createElement("option");
        opt.value = lesson.id;
        opt.textContent = lesson.short || lesson.title || lesson.id;
        if (lesson.id === activeId) opt.selected = true;
        select.appendChild(opt);
      });
    }
  }

  /* ---------------------------------------------------------
     Section B — Generic card renderer (lesson-agnostic)
     --------------------------------------------------------- */

  // Map group-id → palette slot (1..7), assigned in document order
  // so the first phrase on the page uses slot 1, the second slot 2,
  // and so on. Repeats reuse the same slot.
  var slotByGroupId = Object.create(null);
  var slotCursor = 0;
  // Lazy card-stack lookup. Resolved on first card render so that
  // landing pages (which have no [data-card-stack]) don't force the
  // IIFE to short-circuit before reaching LC_renderLanding.
  var stack = null;
  function getStack() {
    if (!stack) stack = document.querySelector("[data-card-stack]");
    return stack;
  }
  function slotFor(groupId) {
    if (!slotByGroupId[groupId]) {
      slotCursor = (slotCursor % 7) + 1;
      slotByGroupId[groupId] = slotCursor;
    }
    return slotByGroupId[groupId];
  }

  function makeLine(labelText, locale) {
    var p = document.createElement("p");
    p.className = "line";

    var label = document.createElement("span");
    label.className = "line-label";
    label.textContent = labelText;
    label.lang = "en";

    var text = document.createElement("span");
    text.className = "line-text";
    text.lang = locale.code;
    text.dir = locale.dir;

    p.appendChild(label);
    p.appendChild(text);
    return { p: p, text: text };
  }

  function renderLine(lineTextEl, card, localeKey, locale) {
    var groups = card.groups;
    var unpaired = (card.unpaired && card.unpaired[localeKey]) || [];
    lineTextEl.innerHTML = "";

    var ordered = groups.map(function (g) {
      return { kind: "phrase", g: g };
    });
    unpaired.forEach(function (txt) {
      ordered.push({ kind: "unpaired", text: txt });
    });

    function endsWithSpace(s) {
      return /\s$/.test(s);
    }

    ordered.forEach(function (frag, i) {
      var sepNeeded = false;
      if (i > 0) {
        var prevNode = lineTextEl.lastChild;
        var prevText = prevNode ? prevNode.textContent : "";
        if (!endsWithSpace(prevText)) sepNeeded = true;
      }

      if (frag.kind === "phrase") {
        if (sepNeeded) lineTextEl.appendChild(document.createTextNode(" "));
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "phrase";
        btn.lang = locale.code;
        btn.dir = locale.dir;
        btn.tabIndex = 0;
        btn.setAttribute("data-pair", frag.g.id);
        btn.setAttribute("data-index", String(i + 1));
        var bits = [frag.g.source + " ↔ " + frag.g.target];
        if (frag.g.gloss) bits.push("(" + frag.g.gloss + ")");
        btn.setAttribute("aria-label", bits.join(" "));
        var slot = slotFor(frag.g.id);
        btn.style.setProperty("--slot-bg", "var(--slot-" + slot + "-bg)");
        btn.style.setProperty("--slot-bd", "var(--slot-" + slot + "-bd)");
        btn.addEventListener("focus", onPhraseFocus);
        btn.addEventListener("blur", onPhraseBlur);
        btn.addEventListener("mouseenter", onPhraseFocus);
        btn.addEventListener("mouseleave", onPhraseBlur);

        // Render the phrase text, optionally wrapping a declared
        // suffix substring in a <span class="suffix"> for visual
        // emphasis. Suffix may be locale-specific (e.g. "sourceSuffix")
        // or shared ("suffix"). The suffix is matched verbatim; by
        // default it must appear at the end of the phrase, but a
        // group may also set `targetSuffixPos` to anchor the suffix
        // at an explicit index so mid-phrase inflections (like the
        // "র" possessive on "আমার") can be marked too.
        var phraseText = frag.g[localeKey];
        var suffix =
          frag.g[localeKey + "Suffix"] != null
            ? frag.g[localeKey + "Suffix"]
            : frag.g.suffix;
        var suffixPos = frag.g[localeKey + "SuffixPos"];
        if (suffix && phraseText && phraseText.length >= suffix.length) {
          var cut;
          if (suffixPos != null) {
            cut = suffixPos;
          } else {
            cut = phraseText.length - suffix.length;
          }
          if (phraseText.slice(cut, cut + suffix.length) === suffix) {
            var head = phraseText.slice(0, cut);
            if (head) btn.appendChild(document.createTextNode(head));
            var suf = document.createElement("span");
            suf.className = "suffix";
            suf.textContent = suffix;
            btn.appendChild(suf);
            var tail = phraseText.slice(cut + suffix.length);
            if (tail) btn.appendChild(document.createTextNode(tail));
          } else {
            btn.textContent = phraseText;
          }
        } else {
          btn.textContent = phraseText;
        }

        // Wire the hover/floating panel for Turkish words. We only
        // attach the panel when the source locale is Turkish —
        // other languages don't have base/suffix data, and the
        // existing pair-highlight behavior is sufficient there.
        if (localeKey === "source" && locale.code === "tr") {
          attachHoverPanelHandlers(btn, frag.g, locale);
        }

        lineTextEl.appendChild(btn);
      } else {
        if (sepNeeded) lineTextEl.appendChild(document.createTextNode(" "));
        var un = document.createElement("span");
        un.className = "unpaired";
        un.textContent = frag.text;
        un.lang = locale.code;
        un.dir = locale.dir;
        lineTextEl.appendChild(un);
      }
    });

    var content = (lineTextEl.textContent || "").trim();
    if (content && !/[.!?।۔؟]$/.test(content)) {
      var tail = document.createElement("span");
      tail.className = "unpaired";
      tail.textContent = locale.code === "tr" ? "." : "।";
      tail.lang = locale.code;
      tail.dir = locale.dir;
      lineTextEl.appendChild(tail);
    }
  }

  function renderCard(lesson, card) {
    var art = document.createElement("article");
    art.className = "card";
    art.setAttribute("data-card", "");
    if (lesson.target && lesson.target.font) {
      art.style.setProperty("--target-font", "var(--font-" + lesson.target.font + ")");
    }

    var head = document.createElement("header");
    head.className = "card-head";

    var expression = document.createElement("h3");
    expression.className = "expression";
    expression.textContent = card.expression;
    expression.lang = lesson.source.code;
    expression.dir = lesson.source.dir;

    var meaning = document.createElement("p");
    meaning.className = "meaning";

    var meaningEn = document.createElement("span");
    meaningEn.className = "meaning-en";
    meaningEn.textContent = card.meaning;
    meaningEn.lang = "en";
    meaning.appendChild(meaningEn);

    if (card.meaningBn || (lesson.target && card[lesson.target.code])) {
      var sep = document.createElement("span");
      sep.className = "meaning-sep";
      sep.textContent = " · ";
      sep.setAttribute("aria-hidden", "true");
      meaning.appendChild(sep);

      var meaningTg = document.createElement("span");
      meaningTg.className = "meaning-tg";
      meaningTg.textContent = card.meaningBn || card[lesson.target.code] || "";
      meaningTg.lang = lesson.target.code;
      meaningTg.dir = lesson.target.dir;
      meaning.appendChild(meaningTg);
    }

    head.appendChild(expression);
    head.appendChild(meaning);

    art.appendChild(head);

    var sentences = document.createElement("div");
    sentences.className = "sentences";

    var src = makeLine(lesson.source.label, lesson.source);
    var tgt = makeLine(lesson.target.label, lesson.target);
    sentences.appendChild(src.p);
    sentences.appendChild(tgt.p);
    art.appendChild(sentences);

    renderLine(src.text, card, "source", lesson.source);
    renderLine(tgt.text, card, "target", lesson.target);

    // Sentence-level translate affordance. Per-lesson: if the
    // lesson declares `translate: { sl, tl }`, wrap the source
    // line text in a flex container and append a Translate button
    // that opens Google Translate in a single reused tab.
    if (lesson.translate) {
      var body = document.createElement("span");
      body.className = "line-body";
      src.p.replaceChild(body, src.text);
      body.appendChild(src.text);

      var sentenceQuery = buildSentenceText(card, "source");
      var sBtn = document.createElement("button");
      sBtn.type = "button";
      sBtn.className = "gt-sentence";
      sBtn.textContent = "🔊 Translate";
      sBtn.title = "Translate the " + lesson.source.label +
                   " sentence to " + lesson.target.label;
      sBtn.setAttribute("aria-label",
        "Translate the " + lesson.source.label +
        " sentence to " + lesson.target.label);
      sBtn.addEventListener("click", function () {
        openInTranslateTab(sentenceQuery, lesson);
      });
      body.appendChild(sBtn);

      // Native-pronunciation speaker. Only enabled for Turkish today
      // because that's the only lesson family with a TTS provider
      // wired in. The button stays in the DOM for other languages so
      // it's easy to opt them in by adding a tts.* block later; the
      // click handler is a no-op when no provider is registered.
      var speakBtn = document.createElement("button");
      speakBtn.type = "button";
      speakBtn.className = "tts-sentence";
      speakBtn.textContent = "\uD83C\uDFA7 Listen"; // 🔊 Listen
      speakBtn.title = "Hear the " + lesson.source.label +
                       " sentence read natively";
      speakBtn.setAttribute("aria-label",
        "Hear the " + lesson.source.label +
        " sentence read natively");
      // Mark the language so the front-end TTS module can pick the
      // right provider. Turkish-only today; this is the seam for
      // adding more.
      speakBtn.setAttribute("data-tts-lang", lesson.source.code);
      speakBtn.addEventListener("click", function () {
        // Strategy registry decides which provider handles this lang.
        // Setting LC_TTS_PROVIDER (default "elevenlabs") switches the
        // active provider without touching this file.
        if (typeof window.LC_speakSentence === "function") {
          window.LC_speakSentence(
            lesson.source.code,
            sentenceQuery,
            speakBtn
          );
        }
      });
      body.appendChild(speakBtn);
    }

    return art;
  }

  // Build the visible source (or target) text for a card so the
  // sentence button sends exactly what the user sees.
  function buildSentenceText(card, localeKey) {
    var parts = card.groups.map(function (g) { return g[localeKey]; });
    var tail = (card.unpaired && card.unpaired[localeKey]) || [];
    tail.forEach(function (t) { parts.push(t); });
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  // Monotonic focus token so a stale blur from a previous phrase
  // can never clear the focus state of a newer one. Any new
  // focus event bumps the counter; the blur handler only acts
  // if its captured token still matches the current value.
  var focusToken = 0;

  function applyFocus(targetEl) {
    var el = targetEl;
    var pid = el.getAttribute("data-pair");
    var card = el.closest(".card");
    if (!card) return;
    card.querySelectorAll(".line").forEach(function (line) {
      line.classList.add("has-focus");
    });
    card.querySelectorAll(".phrase").forEach(function (p) {
      if (p.getAttribute("data-pair") === pid) {
        p.classList.add("is-focus-self");
      } else {
        p.classList.remove("is-focus-self");
      }
    });
  }

  function clearFocus() {
    var stk = getStack();
    if (!stk) return;
    stk.querySelectorAll(".line").forEach(function (line) {
      line.classList.remove("has-focus");
    });
    stk.querySelectorAll(".phrase").forEach(function (p) {
      p.classList.remove("is-focus-self");
    });
  }

  function onPhraseFocus(e) {
    var myToken = ++focusToken;
    var el = e.currentTarget;
    applyFocus(el);
    // Verify the focus is still "current" after the event loop
    // tick — if another focus event arrived in between, our
    // mutation should be left alone.
    setTimeout(function () {
      if (myToken !== focusToken) return;
      // Re-apply in case the blur from a sibling briefly cleared
      // state during rapid hover transitions.
      applyFocus(el);
    }, 0);
  }

  function onPhraseBlur(e) {
    var myToken = focusToken;
    var el = e.currentTarget;
    setTimeout(function () {
      // If a newer focus event has arrived, do nothing.
      if (myToken !== focusToken) return;
      // If focus is still on a phrase (keyboard tab navigation),
      // hand the focus state to wherever focus actually is.
      var active = document.activeElement;
      var stk = getStack();
      if (
        active &&
        active.classList &&
        active.classList.contains("phrase") &&
        stk && stk.contains(active)
      ) {
        applyFocus(active);
        return;
      }
      // If the mouse is hovered over another phrase (mouseenter
      // may have fired blur without firing focus on the same
      // element), check elementFromPoint at the cursor.
      if (
        e && e.relatedTarget &&
        e.relatedTarget.classList &&
        e.relatedTarget.classList.contains("phrase") &&
        stk && stk.contains(e.relatedTarget)
      ) {
        applyFocus(e.relatedTarget);
        return;
      }
      clearFocus();
    }, 0);
  }

  /* ---------------------------------------------------------
     Section C — Google Translate: a single reusable tab
     ---------------------------------------------------------
     We open translate.google.com directly with a fixed window
     name. The browser reuses the same tab for subsequent calls
     with the same name, so the user always sees exactly one
     translate tab regardless of how many times they click.

     Why no shim? We previously routed through a same-origin
     translate.html to bypass popup blockers, but a fixed window
     name plus direct URL is enough for the browser to reuse
     the tab and stay on the popup-blocker safe side.
     --------------------------------------------------------- */
  var GT_WINDOW_NAME = "lc-gt-window";

  function buildTranslateUrl(query, lesson) {
    var sl = lesson.translate.sl;
    var tl = lesson.translate.tl;
    return (
      "https://translate.google.com/?sl=" + sl +
      "&tl=" + tl +
      "&text=" + encodeURIComponent(query) +
      "&op=translate"
    );
  }

  function openInTranslateTab(query, lesson) {
    query = (query || "").trim();
    if (!query || !lesson || !lesson.translate) return;
    var url = buildTranslateUrl(query, lesson);
    // Same name → browser navigates the existing tab if open,
    // otherwise opens a fresh one. Always exactly one tab.
    window.open(url, GT_WINDOW_NAME);
  }

  /* ---------------------------------------------------------
     Section D — Active-lesson rendering
     --------------------------------------------------------- */

  function renderActiveLesson() {
    var id = getActiveLessonId();
    var lesson = lessons.find(function (l) { return l.id === id; });
    var stk = getStack();
    if (!stk) return;
    // Reset palette so slot assignment is consistent within the
    // active lesson only (slots are document-order, not lesson-
    // global — keeps cross-highlighting meaningful).
    slotByGroupId = Object.create(null);
    slotCursor = 0;
    stk.innerHTML = "";
    if (!lesson) return;
    lesson.cards.forEach(function (card) {
      stk.appendChild(renderCard(lesson, card));
    });
    // Reflect the new active lesson in the dropdown (in case it
    // was triggered by sidebar click rather than select change).
    var select = document.querySelector("[data-lesson-select]");
    if (select && select.value !== lesson.id) {
      select.value = lesson.id;
    }
  }

  /* ---------------------------------------------------------
     Section E — Hover/floating panel for Turkish words
     ---------------------------------------------------------
     When the user hovers a Turkish phrase button, a small panel
     pops up showing:
       - the base/root word (without the suffix, e.g. "anne")
       - Bengali meaning of the base form (e.g. "মা")
       - Bengali meaning of the inflected form (e.g. "আমার মা")
       - an audio button that calls window.LC_speakSentence
       - a Google Translate link for the word

     The panel is a singleton DOM node appended to <body>; we
     position it relative to the word's bounding rect, flipping
     above/below to avoid clipping at viewport edges. Mouseover
     on the panel itself is allowed (so users can click buttons)
     via a small hide-delay on mouseleave.
     --------------------------------------------------------- */
  var hoverPanel = null;
  var hoverHideTimer = 0;
  var hoverActiveEl = null;

  function ensureHoverPanel() {
    if (hoverPanel && hoverPanel.parentNode) return hoverPanel;
    var p = document.createElement("div");
    p.className = "phrase-hover-panel";
    p.setAttribute("role", "tooltip");
    p.setAttribute("aria-hidden", "true");
    p.hidden = true;
    var arrow = document.createElement("span");
    arrow.className = "phrase-hover-arrow";
    arrow.setAttribute("aria-hidden", "true");
    p.appendChild(arrow);
    // Allow hover over the panel itself so users can click the
    // buttons inside it without it disappearing immediately.
    p.addEventListener("mouseenter", function () {
      if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = 0;
      }
    });
    p.addEventListener("mouseleave", function () {
      scheduleHideHoverPanel();
    });
    document.body.appendChild(p);
    hoverPanel = p;
    return p;
  }

  // Build the panel content for a phrase. We pull the group
  // metadata (base, meaningBase, suffix, target meaning) from
  // the dataset; if missing, we fall back to showing just the
  // visible text so the feature still works for groups that
  // haven't been back-filled yet.
  function renderHoverPanelContent(phraseBtn) {
    var p = ensureHoverPanel();
    // Wipe everything except the arrow (which is the first child).
    while (p.lastChild && p.lastChild !== p.firstChild) {
      p.removeChild(p.lastChild);
    }
    var ds = phraseBtn.dataset;
    var sourceText = ds.sourceText || phraseBtn.textContent || "";
    var baseText = ds.baseText || sourceText;
    var suffixText = ds.suffixText || "";
    var meaningBase = ds.meaningBase || "";
    var meaningForm = ds.meaningForm || "";
    var kind = ds.kind || "word";
    var gloss = ds.gloss || "";
    var lessonLang = ds.lessonLang || "tr";

    // Header: surface form + small "kind" pill (noun / verb)
    var head = document.createElement("div");
    head.className = "phrase-hover-head";
    var word = document.createElement("span");
    word.className = "phrase-hover-word is-source";
    word.lang = lessonLang;
    word.dir = "ltr";
    word.textContent = sourceText;
    head.appendChild(word);
    if (kind) {
      var k = document.createElement("span");
      k.className = "phrase-hover-kind";
      k.textContent = kind;
      head.appendChild(k);
    }
    p.appendChild(head);

    // Row 1: Base form (with suffix badge if any)
    var row1 = document.createElement("div");
    row1.className = "phrase-hover-row";
    var l1 = document.createElement("span");
    l1.className = "phrase-hover-label";
    l1.textContent = "Base";
    var v1 = document.createElement("span");
    v1.className = "phrase-hover-value is-source";
    v1.lang = lessonLang;
    v1.dir = "ltr";
    v1.textContent = baseText;
    if (suffixText) {
      var suf = document.createElement("span");
      suf.className = "phrase-hover-suffix";
      suf.lang = lessonLang;
      suf.dir = "ltr";
      suf.textContent = "+" + suffixText;
      v1.appendChild(suf);
    }
    row1.appendChild(l1);
    row1.appendChild(v1);
    p.appendChild(row1);

    // Row 2: Bengali meaning of the base form
    if (meaningBase) {
      var row2 = document.createElement("div");
      row2.className = "phrase-hover-row";
      var l2 = document.createElement("span");
      l2.className = "phrase-hover-label";
      l2.textContent = "Base meaning";
      var v2 = document.createElement("span");
      v2.className = "phrase-hover-value";
      v2.lang = "bn";
      v2.dir = "ltr";
      v2.textContent = meaningBase;
      row2.appendChild(l2);
      row2.appendChild(v2);
      p.appendChild(row2);
    }

    // Row 3: Bengali meaning of the inflected/suffixed form
    if (meaningForm) {
      var row3 = document.createElement("div");
      row3.className = "phrase-hover-row";
      var l3 = document.createElement("span");
      l3.className = "phrase-hover-label";
      l3.textContent = "As used";
      var v3 = document.createElement("span");
      v3.className = "phrase-hover-value";
      v3.lang = "bn";
      v3.dir = "ltr";
      v3.textContent = meaningForm;
      row3.appendChild(l3);
      row3.appendChild(v3);
      p.appendChild(row3);
    }

    // Optional row 4: gloss (English hint) — helps when meaning is
    // missing or unfamiliar.
    if (gloss) {
      var row4 = document.createElement("div");
      row4.className = "phrase-hover-row";
      var l4 = document.createElement("span");
      l4.className = "phrase-hover-label";
      l4.textContent = "Gloss";
      var v4 = document.createElement("span");
      v4.className = "phrase-hover-value";
      v4.lang = "en";
      v4.dir = "ltr";
      v4.textContent = gloss;
      row4.appendChild(l4);
      row4.appendChild(v4);
      p.appendChild(row4);
    }

    // Actions: audio + Google Translate. Both target the visible
    // surface form so users hear/translate what they see.
    var actions = document.createElement("div");
    actions.className = "phrase-hover-actions";

    var speakBtn = document.createElement("button");
    speakBtn.type = "button";
    speakBtn.className = "phrase-hover-audio";
    speakBtn.setAttribute("data-tts-lang", lessonLang);
    speakBtn.setAttribute("aria-label",
      "Hear " + sourceText + " pronounced natively");
    speakBtn.textContent = "🔊 Listen";
    speakBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.LC_speakSentence === "function") {
        window.LC_speakSentence(lessonLang, sourceText, speakBtn);
      }
    });
    actions.appendChild(speakBtn);

    var gt = document.createElement("a");
    gt.className = "phrase-hover-gt";
    gt.href = "https://translate.google.com/?sl=tr&tl=en&text=" +
      encodeURIComponent(sourceText);
    gt.target = "_blank";
    gt.rel = "noopener noreferrer";
    gt.setAttribute("aria-label",
      "Open " + sourceText + " in Google Translate");
    gt.textContent = "🌐 Translate";
    actions.appendChild(gt);

    p.appendChild(actions);
  }

  // Position the panel relative to a target rect. We try to put
  // it above the word; if there isn't room we flip it below.
  function positionHoverPanel(targetRect) {
    var p = hoverPanel;
    if (!p) return;
    // First render so we have dimensions.
    p.hidden = false;
    var pw = p.offsetWidth;
    var ph = p.offsetHeight;
    var margin = 8;
    var gap = 10;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    // Decide vertical placement: above by default.
    var placeAbove = targetRect.top - ph - gap >= margin;
    var top;
    var arrowDir;
    if (placeAbove) {
      top = targetRect.top - ph - gap;
      arrowDir = "down"; // arrow on panel points down to the word
    } else {
      top = targetRect.bottom + gap;
      arrowDir = "up"; // arrow on panel points up to the word
      // Clamp so it doesn't overflow bottom.
      if (top + ph > vh - margin) top = Math.max(margin, vh - ph - margin);
    }
    // Horizontal: center on the word, but clamp to viewport.
    var left = targetRect.left + targetRect.width / 2 - pw / 2;
    if (left < margin) left = margin;
    if (left + pw > vw - margin) left = vw - pw - margin;
    p.style.insetBlockStart = top + "px";
    p.style.insetInlineStart = left + "px";
    p.setAttribute("data-arrow", arrowDir);
  }

  function showHoverPanel(phraseBtn) {
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = 0;
    }
    hoverActiveEl = phraseBtn;
    ensureHoverPanel();
    renderHoverPanelContent(phraseBtn);
    var rect = phraseBtn.getBoundingClientRect();
    positionHoverPanel(rect);
    hoverPanel.classList.add("is-visible");
    hoverPanel.setAttribute("aria-hidden", "false");
  }

  function scheduleHideHoverPanel() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    // 200ms grace period so the user can move the cursor onto the
    // panel itself and click the audio / translate buttons.
    hoverHideTimer = setTimeout(function () {
      hoverHideTimer = 0;
      if (hoverPanel) {
        hoverPanel.classList.remove("is-visible");
        hoverPanel.setAttribute("aria-hidden", "true");
        // After fade-out we hide() so screen readers skip it.
        setTimeout(function () {
          if (hoverPanel && !hoverPanel.classList.contains("is-visible")) {
            hoverPanel.hidden = true;
          }
        }, 160);
      }
      hoverActiveEl = null;
    }, 200);
  }

  // Reposition the panel on scroll/resize so it stays anchored to
  // the hovered word. Listeners are attached lazily on first show.
  var hoverListenersBound = false;
  function bindHoverReposition() {
    if (hoverListenersBound) return;
    hoverListenersBound = true;
    var reposition = function () {
      if (!hoverActiveEl || !hoverPanel) return;
      if (hoverPanel.classList.contains("is-visible")) {
        var rect = hoverActiveEl.getBoundingClientRect();
        positionHoverPanel(rect);
      }
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    // Keyboard focus also shows the panel — reposition when focus
    // changes via tab navigation.
    document.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("phrase")) {
        showHoverPanel(t);
      }
    });
    document.addEventListener("focusout", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("phrase")) {
        scheduleHideHoverPanel();
      }
    });
  }

  // Wire the hover behavior on every rendered phrase. We attach
  // the listeners here in renderLine so that newly rendered words
  // also get the panel; the dataset attributes carry the group
  // metadata needed by the panel renderer.
  function attachHoverPanelHandlers(btn, group, locale) {
    // Store the metadata on the dataset so renderHoverPanelContent
    // can read it without us threading the group object around.
    btn.dataset.sourceText = group.source || "";
    btn.dataset.baseText = group.base || (group.source || "");
    btn.dataset.suffixText = group.suffix || "";
    btn.dataset.meaningBase = group.meaningBase || "";
    btn.dataset.meaningForm = group.target || "";
    btn.dataset.kind = group.kind || "";
    btn.dataset.gloss = group.gloss || "";
    btn.dataset.lessonLang = locale ? locale.code : "tr";
    // Avoid double-binding if renderCard is somehow called twice.
    if (btn.__hoverPanelBound) return;
    btn.__hoverPanelBound = true;
    btn.addEventListener("mouseenter", function () {
      bindHoverReposition();
      showHoverPanel(btn);
    });
    btn.addEventListener("mouseleave", function () {
      scheduleHideHoverPanel();
    });
  }



  function wireDisplayControls() {
    // Font-size slider — writes --card-size so every card scales
    // together. Persisted in localStorage.
    var fontInput = document.getElementById("font-size");
    if (fontInput) {
      var sizeOut = document.querySelector(".size-value");
      var applySize = function (v) {
        document.documentElement.style.setProperty("--card-size", v + "px");
        if (sizeOut) sizeOut.textContent = v + "px";
        try { window.localStorage.setItem("lc-card-size", v); } catch (e) {}
      };
      var stored = null;
      try { stored = window.localStorage.getItem("lc-card-size"); } catch (e) {}
      if (stored && /^\d+$/.test(stored)) {
        fontInput.value = stored;
      }
      applySize(fontInput.value);
      fontInput.addEventListener("input", function () {
        applySize(fontInput.value);
      });
    }

    // Plain text checkbox — toggles data-plain on the card region,
    // stripping every phrase mark so the line reads as one stream
    // of normal text. Persisted in localStorage.
    var cardRegion = document.querySelector(".card-region");
    var plainInput = document.getElementById("plain-text");
    if (plainInput && cardRegion) {
      var applyPlain = function (on) {
        cardRegion.setAttribute("data-plain", on ? "on" : "off");
        try { window.localStorage.setItem("lc-plain-text", on ? "1" : "0"); } catch (e) {}
      };
      var plainStored = null;
      try { plainStored = window.localStorage.getItem("lc-plain-text"); } catch (e) {}
      if (plainStored === "1") {
        plainInput.checked = true;
      }
      applyPlain(plainInput.checked);
      plainInput.addEventListener("change", function () {
        applyPlain(plainInput.checked);
      });
    }

    // Lesson selector (mobile) — same handler as sidebar click.
    var select = document.querySelector("[data-lesson-select]");
    if (select) {
      select.addEventListener("change", function () {
        setActiveLesson(select.value);
      });
    }
  }

  /* ---------------------------------------------------------
     Section F — Display controls wiring (toolbar)
     --------------------------------------------------------- */

  /* ---------------------------------------------------------
     Section G — Page-level rendering (real paths, no hash)
     ---------------------------------------------------------
     Each HTML page declares its intent via attributes on <body>:
       - data-view="landing"            → render the lesson list.
       - data-view="lesson"             → render the lesson view.
       - data-lesson="<lesson-id>"      → which lesson to show
                                            (only used when
                                            data-view="lesson").
     Switching lessons from the sidebar navigates to the new
     lesson's HTML file via a plain link click — the URL is the
     source of truth, no JavaScript routing needed.
     --------------------------------------------------------- */

  function getRequestedLessonId() {
    var explicit = document.body.getAttribute("data-lesson");
    if (explicit && lessons.some(function (l) { return l.id === explicit; })) {
      return explicit;
    }
    return lessons[0] ? lessons[0].id : null;
  }

  /* ---------------------------------------------------------
     Section H — Init
     --------------------------------------------------------- */

  function init() {
    var view = document.body.getAttribute("data-view") || "auto";
    if (view === "lesson") {
      var id = getRequestedLessonId();
      if (id) {
        try { window.localStorage.setItem(LS_ACTIVE, id); } catch (e) {}
        document.body.setAttribute("data-active-lesson", id);
        renderRegistry(id);
        renderActiveLesson();
        wireDisplayControls();
      }
      return;
    }
    if (view === "landing") {
      // Pages that want a custom landing renderer can call
      // window.LC_renderLanding(opts) themselves; otherwise we
      // fall back to a sensible default: render the registered
      // lessons into [data-landing-list]. Skip the fallback if
      // the page's inline script already populated the
      // container (signalled via data-rendered="landing").
      var landingContainer = document.querySelector("[data-landing-list]");
      if (
        landingContainer &&
        landingContainer.getAttribute("data-rendered") !== "landing" &&
        typeof window.LC_renderLanding === "function"
      ) {
        window.LC_renderLanding();
      }
      wireDisplayControls();
      return;
    }
    // Auto mode: pick lesson view if there's a card stack,
    // landing if there's a list.
    if (document.querySelector("[data-card-stack]")) {
      document.body.setAttribute("data-view", "lesson");
      init();
      return;
    }
    if (document.querySelector("[data-landing-list]")) {
      document.body.setAttribute("data-view", "landing");
      init();
      return;
    }
  }

  // Expose minimal helpers so HTML pages can drive the renderer
  // directly. Each page declares its intent via a `data-view`
  // attribute on <body>:
  //   - data-view="landing"   → render the landing page from
  //                              the registered lessons.
  //   - data-view="lesson"    → render the lesson view; the
  //                              lesson id is taken from the
  //                              `data-lesson` attribute on body
  //                              or from window.LC_LESSONS[0].
  // The auto-init runs once at DOMContentLoaded and dispatches
  // based on those attributes.
  window.LC_renderLanding = function (opts) {
    opts = opts || {};
    var container = document.querySelector(opts.container || "[data-landing-list]");
    if (!container || !Array.isArray(window.LC_LESSONS)) return;
    // Mark this container as having been populated by an explicit
    // call so init()'s default fallback won't clobber it.
    container.setAttribute("data-rendered", "landing");
    container.innerHTML = "";
    var resolveHref = opts.resolveHref || function (lesson) {
      return (lesson.path ? lesson.path + ".html" : lesson.id + ".html");
    };
    window.LC_LESSONS.forEach(function (lesson) {
      var a = document.createElement("a");
      a.className = "lesson-card";
      a.href = resolveHref(lesson);
      var t = document.createElement("span");
      t.className = "lesson-card-title";
      t.textContent = lesson.title || lesson.id;
      a.appendChild(t);
      if (lesson.short && lesson.short !== lesson.title) {
        var s = document.createElement("span");
        s.className = "lesson-card-short";
        s.textContent = lesson.short;
        a.appendChild(s);
      }
      if (lesson.summary) {
        var p = document.createElement("p");
        p.className = "lesson-card-summary";
        p.textContent = lesson.summary;
        a.appendChild(p);
      }
      var meta = document.createElement("span");
      meta.className = "lesson-card-meta";
      if (lesson.source && lesson.source.label && lesson.target && lesson.target.label) {
        meta.textContent = lesson.source.label + " → " + lesson.target.label;
      }
      if (lesson.cards && lesson.cards.length) {
        meta.textContent += " · " + lesson.cards.length + " cards";
      }
      a.appendChild(meta);
      container.appendChild(a);
    });
  };

  // Expose a helper that lesson HTML pages can call after both
  // data and app.js have loaded, to set the active lesson before
  // rendering. Pass null/undefined to fall back to the first
  // registered lesson.
  window.LC_setActiveLesson = function (id) {
    if (id && lessons.some(function (l) { return l.id === id; })) {
      try { window.localStorage.setItem(LS_ACTIVE, id); } catch (e) {}
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
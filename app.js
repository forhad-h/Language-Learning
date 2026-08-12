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

  var stack = document.querySelector("[data-card-stack]");
  if (!stack) return;

  // Map group-id → palette slot (1..7), assigned in document order
  // so the first phrase on the page uses slot 1, the second slot 2,
  // and so on. Repeats reuse the same slot.
  var slotByGroupId = Object.create(null);
  var slotCursor = 0;
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
    stack.querySelectorAll(".line").forEach(function (line) {
      line.classList.remove("has-focus");
    });
    stack.querySelectorAll(".phrase").forEach(function (p) {
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
      if (
        active &&
        active.classList &&
        active.classList.contains("phrase") &&
        stack.contains(active)
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
        stack.contains(e.relatedTarget)
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
    // Reset palette so slot assignment is consistent within the
    // active lesson only (slots are document-order, not lesson-
    // global — keeps cross-highlighting meaningful).
    slotByGroupId = Object.create(null);
    slotCursor = 0;
    stack.innerHTML = "";
    if (!lesson) return;
    lesson.cards.forEach(function (card) {
      stack.appendChild(renderCard(lesson, card));
    });
    // Reflect the new active lesson in the dropdown (in case it
    // was triggered by sidebar click rather than select change).
    var select = document.querySelector("[data-lesson-select]");
    if (select && select.value !== lesson.id) {
      select.value = lesson.id;
    }
  }

  /* ---------------------------------------------------------
     Section E — Display controls wiring (toolbar)
     --------------------------------------------------------- */

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
     Section F — Page-level rendering (real paths, no hash)
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
     Section G — Init
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
      // lessons into [data-landing-list].
      var hasContainer = document.querySelector("[data-landing-list]");
      if (hasContainer && typeof window.LC_renderLanding === "function") {
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
/* app.js — render every card from window.LESSONS[*] into one page.
 *
 * Each card is a self-contained <article> with its own phrase tokens.
 * Phrase groups share a stable `data-pair` id so that hovering or
 * focusing a phrase anywhere on the page highlights every phrase
 * that carries the same id (and dims the rest of that line).
 *
 * All phrase fragments are inserted with `textContent`; HTML in
 * lesson data is never evaluated. Per-element `lang` and `dir` come
 * from the lesson locale, so an Arabic card will render correctly
 * without any code change beyond adding data.
 */

(function () {
  "use strict";

  var lessons = window.LESSONS || [];
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

    // Helper: does a string already end with whitespace?
    function endsWithSpace(s) {
      return /\s$/.test(s);
    }

    ordered.forEach(function (frag, i) {
      // Insert a single space separator before any fragment whose
      // own text doesn't already start with whitespace AND whose
      // previous visible fragment didn't end with whitespace.
      // (Skipped for the very first fragment.)
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
            // Explicit anchor: split phraseText at suffixPos.
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

  function renderCard(lesson, card, cardIndex, total) {
    var art = document.createElement("article");
    art.className = "card";
    art.setAttribute("data-card", "");

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

    if (card.meaningBn) {
      var sep = document.createElement("span");
      sep.className = "meaning-sep";
      sep.textContent = " · ";
      sep.setAttribute("aria-hidden", "true");
      meaning.appendChild(sep);

      var meaningBn = document.createElement("span");
      meaningBn.className = "meaning-bn";
      meaningBn.textContent = card.meaningBn;
      meaningBn.lang = lesson.target.code;
      meaningBn.dir = lesson.target.dir;
      meaning.appendChild(meaningBn);
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

    return art;
  }

  function onPhraseFocus(e) {
    var el = e.currentTarget;
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
  function onPhraseBlur() {
    setTimeout(function () {
      var active = document.activeElement;
      if (
        active &&
        active.classList &&
        active.classList.contains("phrase") &&
        stack.contains(active)
      ) {
        return;
      }
      stack.querySelectorAll(".line").forEach(function (line) {
        line.classList.remove("has-focus");
      });
      stack.querySelectorAll(".phrase").forEach(function (p) {
        p.classList.remove("is-focus-self");
      });
    }, 0);
  }

  function init() {
    var totalAcross = lessons.reduce(function (n, l) { return n + l.cards.length; }, 0);
    var cardNum = 0;
    lessons.forEach(function (lesson) {
      lesson.cards.forEach(function (card) {
        cardNum += 1;
        stack.appendChild(renderCard(lesson, card, cardNum, totalAcross));
      });
    });

    // Wire the font-size slider to the --card-size custom property so
    // every card scales together. Persist the user's choice so a
    // reload keeps their preferred reading size.
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

    // Wire the "plain text" checkbox. When checked, the card region
    // gets data-plain="on", which strips every phrase mark so the
    // Turkish and Bengali lines read as one continuous stream of
    // normal text. The choice is persisted in localStorage.
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

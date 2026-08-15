/* Letter wave helper
   Usage: add class "letters-wave" on any title/subtitle element.
   The script wraps text characters into span.char-wave with staggered delay.
*/
(function () {
  "use strict";

  function shouldSkipLetterWave() {
    const ua = navigator.userAgent || "";
    const android = /Android/i.test(ua);
    const canMatch = typeof window.matchMedia === "function";
    const coarse = canMatch ? window.matchMedia("(pointer: coarse)").matches : false;
    const narrow = canMatch ? window.matchMedia("(max-width: 960px)").matches : (window.innerWidth || 0) <= 960;
    const reducedMotion = canMatch ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    return reducedMotion || android || (coarse && narrow);
  }

  if (shouldSkipLetterWave()) return;

  function splitTextNode(textNode, startIndexObj) {
    const text = textNode.nodeValue || "";
    if (!text.trim()) return null;

    const frag = document.createDocumentFragment();
    for (const ch of text) {
      if (ch === " ") {
        frag.appendChild(document.createTextNode(" "));
        continue;
      }
      const span = document.createElement("span");
      span.className = "char-wave";
      span.style.setProperty("--char-delay", (startIndexObj.value * 16) + "ms");
      span.textContent = ch;
      startIndexObj.value += 1;
      frag.appendChild(span);
    }
    return frag;
  }

  function wrapLetters(root, indexObj) {
    const children = Array.from(root.childNodes);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        const replacement = splitTextNode(node, indexObj);
        if (replacement) node.replaceWith(replacement);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        wrapLetters(node, indexObj);
      }
    }
  }

  function initLettersWave() {
    // Auto-opt-in for common title/subtitle selectors when not explicitly tagged.
    const autoSelectors = [
      ".title-fx",
      ".subtitle-fx",
      ".panel-card h3",
      ".chat-header h1"
    ];
    autoSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.classList.add("letters-wave"));
    });

    const targets = document.querySelectorAll(".letters-wave");
    targets.forEach((el) => {
      if (el.dataset.waveReady === "1") return;
      const idx = { value: 0 };
      wrapLetters(el, idx);
      el.dataset.waveReady = "1";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLettersWave, { once: true });
  } else {
    initLettersWave();
  }
})();

// content/linkedin_detector.js
(() => {
  // Prevent double-initializing on SPA navigations
  if (window.__JV_LI_LISTENER__) return;
  window.__JV_LI_LISTENER__ = true;

  const APPLY_RX = /(easy apply|apply on company site|apply|continue|start application)/i;

  function onClickCapture(e) {
    const el = e.target?.closest?.("a,button");
    if (!el) return;

    const text = (el.innerText || el.ariaLabel || "").toLowerCase();
    const href = (el.getAttribute("href") || "").toLowerCase();
    if (!APPLY_RX.test(text) && !/apply/.test(href)) return;

    const isEA = /easy apply/i.test(text);
    const snap = buildSnapshot(isEA ? "EA" : "EXT");

    try {
      const p = chrome.runtime.sendMessage({ type: "JV_SET_PENDING", payload: snap });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }

  function buildSnapshot(applyKind) {
    expandSeeMore();

    const role =
      textOf(".jobs-unified-top-card__job-title") ||
      textOf('[data-test="job-detail-title"]') ||
      textOf("h1") ||
      document.title;

    const company =
      textOf(".job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name") ||
      textOf(".jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name, a.topcard__org-name-link") ||
      "";

    const jdText = extractJDText();

    return {
      applyKind,
      url: location.href,
      title: document.title,
      role,
      company,
      jdText,
      jdSource: "inline"
    };
  }

  function textOf(sel) {
    const el = document.querySelector(sel);
    return el?.textContent?.trim() || "";
  }

  function expandSeeMore() {
    // Expand LinkedIn "See more" in the JD area if present
    document.querySelectorAll("button.show-more-less-html__button").forEach((b) => {
      try { b.click(); } catch {}
    });
  }

  function extractJDText() {
    // Try right-hand detail panel first, then general fallbacks
    const sels = [
      '[data-test="job-description-text"]',
      '[data-test="job-details"] .jobs-description__content',
      ".jobs-description__content",
      ".jobs-description__container",
      ".jobs-description-content__text",
      ".jobs-box__html-content",
      'article[role="article"]',
      "main"
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      const txt = el?.innerText?.trim() || "";
      if (txt.length >= 300) return txt;
    }

    // Fallback to large user selection
    const sel = window.getSelection()?.toString()?.trim();
    if (sel && sel.length >= 200) return sel;

    return "";
  }

  // Attach once, capture phase to catch clicks before navigation
  window.addEventListener("click", onClickCapture, { capture: true });
})();

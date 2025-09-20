// content/overlay.js
(() => {
  // Singleton so multiple injections don't collide
  const JV =
    (globalThis.__JV_OVERLAY__ =
      globalThis.__JV_OVERLAY__ || { mounted: false, booted: false, snap: null , autoTimer: null});
  if (JV.booted) return; // this file already evaluated
  JV.booted = true;

  // Listen for "show overlay" with an ephemeral snapshot
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "JV_SHOW_OVERLAY" && msg.snapshot) {
      JV.snap = msg.snapshot;
      renderOrUpdate();
    }
  });

    // ---- timing helpers ----
  // Render (or update) the panel — no Easy Apply toggle here anymore
  const AUTO_CLOSE_MS = 5 * 60 * 1000; // 30 minutes
  function scheduleAutoClose() {
    try { clearTimeout(JV.autoTimer); } catch {}
    JV.autoTimer = setTimeout(closeOverlay, AUTO_CLOSE_MS);
  }
  function closeOverlay() {
    try { document.getElementById("jv-panel-root")?.remove(); } catch {}
    try { clearTimeout(JV.autoTimer); } catch {}
    JV.mounted = false;
    JV.snap = null;
  }

  // Render (or update) the panel — no Easy Apply toggle here anymore
  function renderOrUpdate() {
    const exists = document.getElementById("jv-panel-root");
    if (exists) {
      updatePanel(exists, JV.snap);
      scheduleAutoClose();
      return;
    }

    JV.mounted = true;
    const root = document.createElement("div");
    root.id = "jv-panel-root";
    root.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;background:#fff;border:1px solid #e1e1e1;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);font-family:system-ui,sans-serif;color:#111;";
    root.innerHTML = panelHTML();
    document.documentElement.appendChild(root);
    wireHandlers(root);
    updatePanel(root, JV.snap);
    scheduleAutoClose();
  }

  function panelHTML() {
    return `
      <div style="padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <strong style="font-size:14px">JD captured from LinkedIn</strong>
          <button id="jv-close" title="Close" style="border:none;background:transparent;font-weight:700;cursor:pointer">×</button>
        </div>
        <div id="jv-sub" style="font-size:12px;color:#444;margin-top:4px"></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button id="jv-upload" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:8px;cursor:pointer">Upload Resume</button>
          <button id="jv-save" style="flex:1;padding:8px;border:1px solid #1769e0;background:#1769e0;color:#fff;border-radius:8px;cursor:pointer">Save Locally</button>
        </div>
        <div style="margin-top:8px;font-size:12px;color:#555">
          <a href="#" id="jv-view">View JD</a>
        </div>
        <input id="jv-file" type="file" accept=".pdf,.doc,.docx" style="display:none"/>
        <div id="jv-msg" style="margin-top:8px;font-size:12px;color:#0a0;"></div>
      </div>
    `;
  }

  function updatePanel(root, snap) {
    const sub = root.querySelector("#jv-sub");
    sub.textContent = `${snap?.company || "Unknown"} — ${snap?.role || ""}`;
  }

  function wireHandlers(root) {
    const msg = (t, col = "#0a0") => {
      const el = root.querySelector("#jv-msg");
      el.textContent = t;
      el.style.color = col;
    };

    // Close: remove panel; no persistence
    root.querySelector("#jv-close").onclick = () => {
      closeOverlay();
    };

    // View JD
    root.querySelector("#jv-view").onclick = (e) => {
      e.preventDefault();
      alert((JV.snap?.jdText || "").slice(0, 5000) || "No JD captured.");
    };

    // Upload handling
    let resumeBlob = null;
    root.querySelector("#jv-upload").onclick = () =>
      root.querySelector("#jv-file").click();
    root.querySelector("#jv-file").onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) {
        msg("File too large (20MB max)", "#c00");
        return;
      }
      resumeBlob = f;
      msg("Resume ready to save.");
    };

    // Save locally — sends the snapshot directly
    root.querySelector("#jv-save").onclick = async () => {
      if (!JV.snap) { msg("Nothing to save.", "#c00"); return; }
      const payload = {
        snapshot: JV.snap,
        resume: resumeBlob
          ? { name: resumeBlob.name, type: resumeBlob.type, size: resumeBlob.size }
          : null
      };
      if (resumeBlob) payload.resumeDataUrl = await blobToDataURL(resumeBlob);
      const res = await chrome.runtime.sendMessage({ type: "JV_REQUEST_SAVE", payload });
      if (res?.ok) {
        msg("Saved locally.");
        setTimeout(() => { closeOverlay(); }, 700);
      } else {
        msg(res?.error || "Save failed", "#c00");
      }
    };
  }

  function blobToDataURL(blob) {
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }
})();

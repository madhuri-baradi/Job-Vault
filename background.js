// background.js
import { KEYS, DEFAULT_SETTINGS } from "./lib/common.js";

/**
 * No-pending model:
 * - Never stores snapshots.
 * - On JV_SET_PENDING, validate settings and show overlay immediately in that tab,
 *   passing the snapshot directly to the content script.
 */

chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
});

// ---------- settings ----------
async function getSettings() {
  const { [KEYS.SETTINGS]: s } = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
async function setSettings(patch) {
  const cur = await getSettings();
  await chrome.storage.local.set({ [KEYS.SETTINGS]: { ...cur, ...patch } });
}

// ---------- offscreen for file writes ----------
async function ensureOffscreen() {
  if (chrome.offscreen?.hasDocument) {
    const has = await chrome.offscreen.hasDocument();
    if (has) return;
  }
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen/offscreen.html"),
    reasons: ["BLOBS"],
    justification: "Write files to user-chosen Base Folder via File System Access."
  });
}

// ---------- overlay injection (no state) ----------
async function showOverlayInTab(tabId, originUrl, snapshot) {
  // Request host permission when showing panel on non-LinkedIn sites
  if (originUrl && !originUrl.includes("linkedin.com")) {
    try {
      const u = new URL(originUrl);
      const originPattern = `${u.protocol}//${u.host}/*`;
      const has = await chrome.permissions.contains({ origins: [originPattern] });
      if (!has) {
        const granted = await chrome.permissions.request({ origins: [originPattern] });
        if (!granted) return; // user denied
      }
    } catch {}
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/overlay.js"]
    });
    chrome.tabs.sendMessage(tabId, { type: "JV_SHOW_OVERLAY", snapshot }).catch(() => {});
  } catch {}
}

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    // Called by linkedin_detector on Apply
    if (msg?.type === "JV_SET_PENDING") {
      const settings = await getSettings();
      const isEA = msg.payload?.applyKind === "EA";

      // Respect capture toggles / EA disable
      const eaDisabled =
        settings.disableEAAlways ||
        Date.now() < (settings.disableEATodayUntil || 0);

      if (isEA) {
        if (eaDisabled || !settings.captureEA) { send({ ok: false, reason: "EA disabled" }); return; }
      } else {
        if (!settings.captureExt) { send({ ok: false, reason: "EXT capture off" }); return; }
      }

      const tabId = sender.tab?.id;
      if (!tabId) { send({ ok: false }); return; }

      // Build ephemeral snapshot; no persistence
      const snapshot = {
        ...msg.payload,
        id: crypto.randomUUID?.() || String(Date.now()),
        createdAt: Date.now()
      };

      await showOverlayInTab(tabId, snapshot.url, snapshot);
      send({ ok: true });
      return;
    }

    // Disable/enable Easy Apply (no pending to clear anymore)
    if (msg?.type === "JV_DISABLE_EA") {
      if (msg.scope === "today") {
        const d = new Date(); d.setHours(23, 59, 59, 999);
        await setSettings({ disableEATodayUntil: +d });
      } else if (msg.scope === "always") {
        await setSettings({ disableEAAlways: true });
      } else if (msg.scope === "enable") {
        await setSettings({ disableEAAlways: false, disableEATodayUntil: 0 });
      }
      send({ ok: true });
      return;
    }

    // Save request -> offscreen writes (snapshot is provided by the overlay)
    if (msg?.type === "JV_REQUEST_SAVE") {
      const s = await getSettings();
      if (!s.baseDirGranted) { send({ ok: false, error: "No base folder selected" }); return; }
      await ensureOffscreen();
      const res = await chrome.runtime.sendMessage({ type: "JV_OFFSCREEN_WRITE", payload: msg.payload }).catch(() => null);
      send(res || { ok: false, error: "Offscreen write failed" });
      return;
    }

    // Settings helpers
    if (msg?.type === "JV_GET_SETTINGS") {
      send({ ok: true, settings: await getSettings() });
      return;
    }
    if (msg?.type === "JV_SET_SETTINGS") {
      await setSettings(msg.patch || {});
      send({ ok: true });
      return;
    }

    // No other message types in no-pending mode
    send({ ok: false });
  })();
  return true;
});

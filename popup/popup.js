// popup/popup.js
// Uses IndexedDB for the directory handle and chrome.storage.local for settings.

const $ = (sel) => document.querySelector(sel);

// ---------- IDB helpers ----------
function openHandlesDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("jobvault_handles", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function clearBaseDirHandleFromIDB() {
  const db = await openHandlesDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete("baseDir");
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function saveBaseDirHandleToIDB(handle) {
  const db = await openHandlesDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "baseDir");
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getBaseDirHandleFromIDB() {
  const db = await openHandlesDB();
  return await new Promise((res, rej) => {
    const tx = db.transaction("handles", "readonly");
    const rq = tx.objectStore("handles").get("baseDir");
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  });
}
async function ensureRW(handle) {
  const opts = { mode: "readwrite" };
  if (await handle?.queryPermission?.(opts) === "granted") return true;
  if (await handle?.requestPermission?.(opts) === "granted") return true;
  throw new Error("Permission denied");
}

// ---------- settings ----------
async function getSettings() {
  const { settings } = await chrome.runtime.sendMessage({ type: "JV_GET_SETTINGS" });
  return settings;
}
async function setSettings(patch) {
  await chrome.runtime.sendMessage({ type: "JV_SET_SETTINGS", patch });
}

// ---------- UI state ----------
let resumeBlob = null;

init().catch(console.error);

async function init() {
  // Wiring: first-run shortcut to Options
  $("#openSettings").onclick = async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
  };

  // Wire main view
  $("#saveCurrent").onclick = onSaveCurrentPage;
  $("#uploadOnly").onclick = () => $("#file").click();
  $("#file").onchange = onResumePicked;
  $("#saveToggles").onclick = saveTogglesFromMain;
  $("#rechoose").onclick = async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
  };

  // Load settings
  const s = await getSettings();
  const baseGranted = !!s.baseDirGranted;

  // Reflect settings into main view
  $("#chkEA2").checked = !!s.captureEA;
  $("#chkEXT2").checked = !!s.captureExt;

  if (baseGranted) showMain(); else showSetup();
}

function showSetup() {
  $("#setup").classList.remove("hide");
  $("#main").classList.add("hide");
}
function showMain() {
  $("#setup").classList.add("hide");
  $("#main").classList.remove("hide");
  updateBaseInfo();
}

async function updateBaseInfo() {
  const handle = await getBaseDirHandleFromIDB();
  $("#where").textContent = handle ? "Base folder is set." : "No base folder set.";
}

// Optional: Change Base Folder from popup (works on most builds; safe to keep)
async function pickFolder() {
  try {
    if (!("showDirectoryPicker" in window)) throw new Error("unsupported");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveBaseDirHandleToIDB(handle);
    await setSettings({ baseDirGranted: true });
    updateBaseInfo();
  } catch {
    // If blocked, guide them to Options
    await chrome.runtime.openOptionsPage();
    window.close();
  }
}

async function saveTogglesFromMain() {
  const captureEA = $("#chkEA2").checked;
  const captureExt = $("#chkEXT2").checked;
  await setSettings({ captureEA, captureExt });
  $("#msg2").style.color = "#0a0";
  $("#msg2").textContent = "Capture settings saved.";
}

// ---------- Save Current Page ----------
async function onResumePicked(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) {
    $("#msg2").style.color = "#c00";
    $("#msg2").textContent = "File too large (20MB max).";
    return;
  }
  resumeBlob = f;
  $("#resumeStatus").textContent = `Attached: ${f.name}`;
  $("#msg2").textContent = "";
}

async function onSaveCurrentPage() {
  // Ensure base folder exists
  const handle = await getBaseDirHandleFromIDB();
  if (!handle) {
    // If somehow not set, push to Options
    await chrome.runtime.openOptionsPage();
    window.close();
    return;
  }

  try {
    await ensureRW(handle);
  } catch (e) {
    // Permission not granted — forget the existing base folder and force re-setup
     try { await clearBaseDirHandleFromIDB(); } catch {}
     try { await setSettings({ baseDirGranted: false }); } catch {}
     await chrome.runtime.openOptionsPage();
     window.close();
     return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Run capture in the page
  const [{ result: snap }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: captureSnapshotFromPage
  });

  if (!snap || !snap.jdText) {
    $("#msg2").style.color = "#c00";
    $("#msg2").textContent = "Couldn’t capture this page. Try selecting the JD and retry.";
    return;
  }

  // If user typed a company, override the detected value
  const userCompany = ($("#company")?.value || "").trim();
  if (userCompany) snap.company = userCompany;

  const payload = {
    snapshot: snap,
    resume: resumeBlob
      ? { name: resumeBlob.name, type: resumeBlob.type, size: resumeBlob.size }
      : null
  };
  if (resumeBlob) payload.resumeDataUrl = await blobToDataURL(resumeBlob);

  const res = await chrome.runtime.sendMessage({ type: "JV_REQUEST_SAVE", payload });
  if (res?.ok) {
    $("#msg2").style.color = "#0a0";
    $("#msg2").textContent = "Saved locally.";
    resumeBlob = null;
    $("#resumeStatus").textContent = "";
  } else {
    $("#msg2").style.color = "#c00";
    $("#msg2").textContent = res?.error || "Save failed.";
  }
}

// Executed in the page context to collect data
function captureSnapshotFromPage() {
  const url = location.href;
  const title = document.title || "";

  // Expand LinkedIn "See more" if present
  try { document.querySelectorAll("button.show-more-less-html__button").forEach(b => b.click()); } catch {}

  const textOf = (sel) => document.querySelector(sel)?.textContent?.trim() || "";

  // Company (LinkedIn detail panel first; fallback)
  const company =
    textOf(".job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name") ||
    textOf(".jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name") ||
    textOf('meta[property="og:site_name"]') ||
    new URL(location.href).hostname.replace(/^www\./, "");

  const role =
    textOf(".jobs-unified-top-card__job-title") ||
    textOf('[data-test="job-detail-title"]') ||
    textOf("h1") ||
    title;

  // JD text
  const jdSelectors = [
    '[data-test="job-description-text"]',
    '[data-test="job-details"] .jobs-description__content',
    ".jobs-description__content",
    ".jobs-description__container",
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    'article[role="article"]',
    "main"
  ];
  let jdText = "";
  for (const s of jdSelectors) {
    const el = document.querySelector(s);
    const txt = el?.innerText?.trim() || "";
    if (txt.length >= 200) { jdText = txt; break; }
  }
  if (!jdText) {
    const sel = window.getSelection()?.toString()?.trim();
    if (sel && sel.length >= 100) jdText = sel;
  }

  return {
    applyKind: "MANUAL",
    url,
    title,
    role,
    company,
    jdText,
    jdSource: "toolbar"
  };
}

function blobToDataURL(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
}

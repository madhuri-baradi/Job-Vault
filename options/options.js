// options/options.js — settings-only page

const $ = (sel) => document.querySelector(sel);

function openHandlesDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("jobvault_handles", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
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
async function clearBaseDirHandleFromIDB() {
  const db = await openHandlesDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete("baseDir");
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

// settings bridge
async function getSettings() {
  const { settings } = await chrome.runtime.sendMessage({ type: "JV_GET_SETTINGS" });
  return settings;
}
async function setSettings(patch) {
  await chrome.runtime.sendMessage({ type: "JV_SET_SETTINGS", patch });
}

init().catch(console.error);

async function init() {
  // Wire controls
  $("#pickFolder").onclick = pickFolder;
  $("#clearFolder").onclick = clearFolder;
  $("#saveToggles").onclick = saveToggles;

  // Load settings
  const s = await getSettings();
  $("#chkEA").checked = !!s.captureEA;
  $("#chkEXT").checked = !!s.captureExt;

  await updateBaseInfo();
}

async function pickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveBaseDirHandleToIDB(handle);
    await setSettings({ baseDirGranted: true });
    $("#msg").style.color = "#0a0";
    $("#msg").textContent = "Base folder selected.";
  } catch {
    $("#msg").style.color = "#c00";
    $("#msg").textContent = "Folder selection canceled.";
  }
  await updateBaseInfo();
}

async function clearFolder() {
  await clearBaseDirHandleFromIDB();
  await setSettings({ baseDirGranted: false });
  $("#msg").style.color = "#0a0";
  $("#msg").textContent = "Base folder cleared.";
  await updateBaseInfo();
}

async function updateBaseInfo() {
  const [s, handle] = await Promise.all([
    getSettings(),
    getBaseDirHandleFromIDB()
  ]);

  let isSet = !!s.baseDirGranted && !!handle;
  if (isSet && handle?.queryPermission) {
    try {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") isSet = false;
    } catch {
      isSet = false;
    }
  }

  $("#where").textContent = isSet ? "Base folder is set." : "No base folder set.";
}

async function saveToggles() {
  const captureEA = $("#chkEA").checked;
  const captureExt = $("#chkEXT").checked;
  await setSettings({ captureEA, captureExt });
  $("#msg").style.color = "#0a0";
  $("#msg").textContent = "Capture settings saved.";
}

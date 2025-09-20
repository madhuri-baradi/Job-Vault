// offscreen/offscreen.js
import { sanitizeLabel, ymdParts, buildLabelsFromContext } from "../lib/common.js";

async function ensurePermission(handle, mode = "readwrite") {
  const opts = { mode };
  try {
    if (await handle?.queryPermission?.(opts) === "granted") return true;
    if (await handle?.requestPermission?.(opts) === "granted") return true;
  } catch {}
  throw new DOMException("Permission denied", "NotAllowedError");
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg?.type !== "JV_OFFSCREEN_WRITE") return;
    const payload = msg.payload;

    const baseHandle = await getBaseDirHandleFromIDB();
    if (!baseHandle) { send({ ok: false, error: "Base folder not selected" }); return; }

    try {
      await ensurePermission(baseHandle, "readwrite");
      const snapshot = payload.snapshot;
      const now = new Date();
      const { yyyy, mm, dd, ymd } = ymdParts(now);

      const { companyLabel, roleLabel } = buildLabelsFromContext({ company: snapshot.company, role: snapshot.role, url: snapshot.url });

      const yymmDir = await ensureDir(baseHandle, `${yyyy}-${mm}`);
      const ddDir = await ensureDir(yymmDir, dd);
      const baseName = `${ymd}__${companyLabel}__${roleLabel}`;
      const jobDir = await uniqueDir(ddDir, baseName);

      await writeFile(jobDir, "link.txt", snapshot.url + "\n");
      await writeFile(jobDir, "JD.md",
        `# ${snapshot.role || "Untitled"}\n` +
        `**Company:** ${snapshot.company || "Unknown"}\n` +
        `**Date:** ${ymd}\n` +
        `**URL:** ${snapshot.url}\n\n` +
        (snapshot.jdText || "").trim() + "\n"
      );
      await writeFile(jobDir, "metadata.json", JSON.stringify({
        id: snapshot.id,
        company: snapshot.company || "",
        role: snapshot.role || "",
        url: snapshot.url || "",
        status: "Applied",
        notes: "",
        jdSource: snapshot.jdSource || "inline",
        createdAt: snapshot.createdAt || Date.now(),
        savedAt: Date.now(),
        resume: payload.resume ? { name: payload.resume.name, type: payload.resume.type, size: payload.resume.size } : null
      }, null, 2));

      if (payload.resume && payload.resumeDataUrl) {
        const b = await (await fetch(payload.resumeDataUrl)).blob();
        const ext = (payload.resume.name.match(/(\.[a-z0-9]+)$/i) || [".bin"])[0];
        await writeFile(jobDir, `resume${ext}`, b, true);
      }

      send({ ok: true, dirName: baseName });
    } catch (err) {
      send({ ok: false, error: String(err && err.message || err) });
    }
  })();
  return true;
});
async function openHandlesDB() {
  return await new Promise((res, rej) => {
    const req = indexedDB.open("jobvault_handles", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function getBaseDirHandleFromIDB() {
  const db = await openHandlesDB();
  return await new Promise((res, rej) => {
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get("baseDir");
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

async function ensureDir(parent, name) { return await parent.getDirectoryHandle(name, { create: true }); }
async function uniqueDir(parent, base) {
  let name = sanitizeLabel(base, "Job");
  let idx = 1;
  while (await exists(parent, name)) { idx += 1; name = `${base}__${idx}`; }
  return await ensureDir(parent, name);
}
async function exists(parent, name) {
  try { await parent.getDirectoryHandle(name, { create: false }); return true; } catch { return false; }
}
async function writeFile(dirHandle, name, data, isBlob = false) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  if (isBlob) await writable.write(data);
  else await writable.write(new Blob([data], { type: typeof data === "string" ? "text/plain" : "application/octet-stream" }));
  await writable.close();
}

const DB = "jobvault_db";
const STORE = "blobs";
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
export async function putBlob(id, blob, meta = {}) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id, blob, meta, updatedAt: Date.now() });
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}
export async function getBlob(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
export async function delBlob(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

// Persistensi log lokal (IndexedDB) agar riwayat tidak hilang saat aplikasi dibuka ulang
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open("df-phone", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("logs", { keyPath: "key" });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => {
  const t = db.transaction("logs", mode), out = fn(t.objectStore("logs"));
  t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };

/** Mengembalikan true jika entri baru (belum pernah tersimpan). */
export async function addLog(entry) {
  const db = await open();
  return new Promise((res) => {
    const r = db.transaction("logs", "readwrite").objectStore("logs").add(entry);
    r.onsuccess = () => res(true); r.onerror = (e) => { e.preventDefault(); res(false); };
  });
}
export const allLogs = async () => (await tx("readonly", (s) => s.getAll())).sort((a, b) => b.ts - a.ts);
export const clearLogs = () => tx("readwrite", (s) => s.clear());

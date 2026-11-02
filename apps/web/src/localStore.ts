// Local encrypted cache (step 7). Messages shown in the app are cached in IndexedDB encrypted with
// AES-GCM-256. The key is a NON-extractable WebCrypto key stored in IndexedDB on this device only;
// it is never sent anywhere. Cleared on logout and account deletion.
import { seal, unseal } from "./localCrypto";
const DB = "rolff-local", KEYS = "keys", DATA = "data";
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(KEYS); r.result.createObjectStore(DATA); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = <T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest) =>
  new Promise<T>((res, rej) => { const q = f(db.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });

export async function deviceKey(db: IDBDatabase, uid: string): Promise<CryptoKey> {
  const k = await tx<CryptoKey | undefined>(db, KEYS, "readonly", (s) => s.get(uid));
  if (k) return k;
  const nk = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await tx(db, KEYS, "readwrite", (s) => s.put(nk, uid));
  return nk;
}
export async function cacheSet(uid: string, conv: string, value: unknown) {
  try { const db = await open(); const k = await deviceKey(db, uid); const box = await seal(k, value, `${uid}:${conv}`); await tx(db, DATA, "readwrite", (s) => s.put(box, `${uid}:${conv}`)); } catch { /* best effort */ }
}
export async function cacheGet<T>(uid: string, conv: string): Promise<T | null> {
  try { const db = await open(); const box = await tx<any>(db, DATA, "readonly", (s) => s.get(`${uid}:${conv}`)); if (!box) return null;
    return await unseal<T>(await deviceKey(db, uid), box, `${uid}:${conv}`); } catch { return null; }
}
export const cacheClear = () => new Promise<void>((res) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); });

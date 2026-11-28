// Local encrypted cache (step 7). Messages shown in the app are cached in IndexedDB encrypted with
// AES-GCM-256. The key is a NON-extractable WebCrypto key stored in IndexedDB on this device only;
// it is never sent anywhere. Cleared on logout, account switch and account deletion.
//
// After a full close, this cache is what lets a chat slide in with its latest bubbles already
// visible. The server remains the source of truth and is reconciled after the slide.
import { seal, unseal } from "./localCrypto";
import { isRetention, normalizeCached, wrapCache, type Retention } from "./localCache";

const DB = "rolff-local", KEYS = "keys", DATA = "data";
const PREFS = "#prefs";

export type MemoryLocalStore = {
  keys: Map<string, CryptoKey>;
  data: Map<string, { iv: Uint8Array; ct: ArrayBuffer }>;
};

function testStore(): MemoryLocalStore | null {
  const g = (typeof globalThis !== "undefined" ? (globalThis as { __ROLFF_MEMORY_IDB__?: MemoryLocalStore }) : null);
  return g?.__ROLFF_MEMORY_IDB__ ?? null;
}

const open = () => new Promise<IDBDatabase>((res, rej) => {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.open !== "function") { rej(new Error("no_idb")); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(KEYS); r.result.createObjectStore(DATA); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error ?? new Error("idb"));
  } catch (e) { rej(e); }
});
const tx = <T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest) =>
  new Promise<T>((res, rej) => { const q = f(db.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });

export async function deviceKey(db: IDBDatabase | MemoryLocalStore, uid: string): Promise<CryptoKey> {
  const mem = (db && "keys" in db ? db : testStore());
  if (mem && "keys" in mem) {
    const k = mem.keys.get(uid);
    if (k) return k;
    const nk = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    mem.keys.set(uid, nk);
    return nk;
  }
  const k = await tx<CryptoKey | undefined>(db as IDBDatabase, KEYS, "readonly", (s) => s.get(uid));
  if (k) return k;
  const nk = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await tx(db as IDBDatabase, KEYS, "readwrite", (s) => s.put(nk, uid));
  return nk;
}

async function readBox(id: string): Promise<{ iv: Uint8Array; ct: ArrayBuffer } | undefined> {
  const mem = testStore();
  if (mem) return mem.data.get(id);
  try {
    const db = await open();
    return await tx(db, DATA, "readonly", (s) => s.get(id));
  } catch { return undefined; }
}
async function writeBox(id: string, box: { iv: Uint8Array; ct: ArrayBuffer }): Promise<void> {
  const mem = testStore();
  if (mem) { mem.data.set(id, box); return; }
  const db = await open();
  await tx(db, DATA, "readwrite", (s) => s.put(box, id));
}
async function listDataKeys(): Promise<string[]> {
  const mem = testStore();
  if (mem) return [...mem.data.keys()];
  const db = await open();
  return await tx<string[]>(db, DATA, "readonly", (s) => s.getAllKeys() as unknown as IDBRequest);
}

async function keyFor(uid: string): Promise<CryptoKey> {
  const mem = testStore();
  if (mem) return deviceKey(mem, uid);
  return deviceKey(await open(), uid);
}

const memMsgs = new Map<string, unknown[]>();
const memRetention = new Map<string, Retention>();
const inflight = new Map<string, Promise<unknown[] | null>>();

export function peekCachedMessages(conv: string): unknown[] | undefined {
  return memMsgs.get(conv);
}
export function cachedRetention(uid: string): Retention | undefined {
  return memRetention.get(uid);
}
export function rememberCachedMessages(conv: string, messages: unknown[]) {
  memMsgs.set(conv, messages);
}
export function clearCachedMessages() {
  memMsgs.clear();
  inflight.clear();
}

export async function cacheSetPrefs(uid: string, retention: Retention) {
  memRetention.set(uid, retention);
  try {
    const k = await keyFor(uid);
    const box = await seal(k, { retention }, `${uid}:${PREFS}`);
    await writeBox(`${uid}:${PREFS}`, box);
  } catch { /* best effort */ }
}

export async function cacheGetPrefs(uid: string): Promise<Retention | null> {
  const hit = memRetention.get(uid);
  if (hit) return hit;
  try {
    const box = await readBox(`${uid}:${PREFS}`);
    if (!box) return null;
    const v = await unseal<{ retention?: unknown }>(await keyFor(uid), box, `${uid}:${PREFS}`);
    if (!isRetention(v?.retention)) return null;
    memRetention.set(uid, v.retention);
    return v.retention;
  } catch { return null; }
}

export async function cacheSet(uid: string, conv: string, value: unknown, retention?: Retention) {
  try {
    const ret = retention ?? memRetention.get(uid) ?? "unlimited";
    const envelope = wrapCache(Array.isArray(value) ? value : normalizeCached(value).messages, ret);
    rememberCachedMessages(conv, envelope.messages);
    memRetention.set(uid, ret);
    const k = await keyFor(uid);
    const box = await seal(k, envelope, `${uid}:${conv}`);
    await writeBox(`${uid}:${conv}`, box);
  } catch { /* best effort */ }
}

export async function cacheGet<T>(uid: string, conv: string): Promise<T | null> {
  try {
    const box = await readBox(`${uid}:${conv}`);
    if (!box) return null;
    const raw = await unseal<unknown>(await keyFor(uid), box, `${uid}:${conv}`);
    const { messages } = normalizeCached(raw);
    rememberCachedMessages(conv, messages);
    return messages as T;
  } catch { return null; }
}

/** Decrypt this conversation into memory (shared in-flight). Used on list load and on tap start. */
export function loadCachedMessages(uid: string, conv: string): Promise<unknown[] | null> {
  const hit = memMsgs.get(conv);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(conv);
  if (running) return running;
  const task = cacheGet<unknown[]>(uid, conv).finally(() => { if (inflight.get(conv) === task) inflight.delete(conv); });
  inflight.set(conv, task);
  return task;
}

/** Drop cached rows that no longer fall within the user's retention (e.g. after they shorten it). */
export async function pruneCached(uid: string, retention: Retention) {
  memRetention.set(uid, retention);
  const prefix = `${uid}:`;
  try {
    for (const id of await listDataKeys()) {
      if (!id.startsWith(prefix) || id.endsWith(`:${PREFS}`)) continue;
      const conv = id.slice(prefix.length);
      const cur = (memMsgs.get(conv) as unknown[] | undefined) ?? await cacheGet<unknown[]>(uid, conv);
      if (!cur) continue;
      await cacheSet(uid, conv, cur, retention);
    }
  } catch { /* best effort */ }
}

export const cacheClear = () => new Promise<void>((res) => {
  clearCachedMessages();
  memRetention.clear();
  const mem = testStore();
  if (mem) { mem.keys.clear(); mem.data.clear(); res(); return; }
  const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res();
});

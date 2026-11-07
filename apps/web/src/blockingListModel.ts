export type BlockEntry = { id: string; word: string; created_at: string };
export type BlockSort = "alphabetical" | "newest" | "oldest";
/** Database provenance is retained. UUID is only a deterministic tie break, never invented chronology. */
export function sortBlockEntries(entries: BlockEntry[], order: BlockSort, locale = "da"): BlockEntry[] {
 const collator = new Intl.Collator(locale, { sensitivity: "base" });
 const chronological = (a: BlockEntry,b: BlockEntry) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
 return [...entries].sort((a,b)=>order==="alphabetical" ? collator.compare(a.word,b.word)||chronological(a,b) : (order==="newest"?-1:1)*chronological(a,b));
}
/** Explicitly pin every request to the opening account's token; never read mutable global auth during a save. */
export function blockingApi(url: string, key: string, token: string, fetcher: typeof fetch = fetch) {
 return async (path: string, method = "GET", body?: unknown, signal?: AbortSignal) => {
  const r = await fetcher(`${url}/rest/v1/${path}`, { method, signal, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
  if (!r.ok) throw new Error("save_unconfirmed");
  return r.status===204 ? null : r.json();
 };
}

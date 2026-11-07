export type BlockEntry = { id: string; word: string; created_at: string };
export type BlockSort = "alphabetical" | "newest" | "oldest";
/** Canonical UTC microsecond precision. Parse only whole seconds so JS cannot erase sub-ms order. */
function creationInstant(timestamp: string): string {
 const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
 if (!m) throw new Error("invalid_creation_timestamp");
 const utcSecond = new Date(`${m[1]}${m[3]}`).toISOString().slice(0,19);
 return `${utcSecond}.${(m[2] ?? "").padEnd(6,"0")}Z`;
}
/** Database provenance is retained. UUID is only a deterministic tie break, never invented chronology. */
export function sortBlockEntries(entries: BlockEntry[], order: BlockSort, locale = "da"): BlockEntry[] {
 const collator = new Intl.Collator(locale, { sensitivity: "base" });
 const chronological = (a: BlockEntry,b: BlockEntry) => {
  const x=creationInstant(a.created_at),y=creationInstant(b.created_at);
  return (x<y?-1:x>y?1:0) || a.id.localeCompare(b.id);
 };
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

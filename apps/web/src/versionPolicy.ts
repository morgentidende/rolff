// Pure update decision (no DOM), shared by versionCheck.ts and the tests.
export const RELOADED_KEY = "rolff:reloaded-for-build";
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
/** Pure decision: should this page reload to pick up `live`? */
export function shouldReload(current: string, live: string | null | undefined, store: Store | null, blocked: boolean): boolean {
  if (!live || typeof live !== "string" || current === "dev" || live === current) {
    if (live === current) store?.removeItem(RELOADED_KEY);
    return false;
  }
  if (blocked) return false;
  // Loop guard: at most one automatic reload per live build id. If the reload
  // still serves the old page (e.g. a stale cache), we stop and try again only
  // when an even newer build appears.
  if (store?.getItem(RELOADED_KEY) === live) return false;
  return true;
}


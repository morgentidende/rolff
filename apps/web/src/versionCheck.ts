import { RELOADED_KEY, shouldReload, type Store } from "./versionPolicy";
// Make a cold start (or resume) of the installed app always run the newest
// deployed build. The server sends index.html with "no-cache" (see
// public/.htaccess), and as a safety net the app compares its own build id with
// version.json and reloads once when a newer build is live.
declare const __ROLFF_BUILD__: string;
export { shouldReload };
export const BUILD_ID: string = typeof __ROLFF_BUILD__ === "string" ? __ROLFF_BUILD__ : "dev";

const blockers = new Set<string>();
/** While a message/attachment is being sent we never reload. */
export const setReloadBlocked = (key: string, on: boolean) => { if (on) blockers.add(key); else blockers.delete(key); };

let inFlight = false; let last = 0;
export async function checkForUpdate(opts: { fetchImpl?: typeof fetch; reload?: () => void; minGapMs?: number } = {}): Promise<boolean> {
  const now = Date.now();
  if (inFlight || now - last < (opts.minGapMs ?? 10_000)) return false;
  inFlight = true; last = now;
  try {
    const r = await (opts.fetchImpl ?? fetch)(new URL("version.json", document.baseURI).href + "?t=" + now, { cache: "no-store" });
    if (!r.ok) return false;
    const live = (await r.json())?.build;
    let store: Store | null = null; try { store = sessionStorage; } catch { /* private mode */ }
    if (!shouldReload(BUILD_ID, live, store, blockers.size > 0)) return false;
    try { store?.setItem(RELOADED_KEY, live); } catch { /* ignore */ }
    (opts.reload ?? (() => location.reload()))();
    return true;
  } catch { return false; } finally { inFlight = false; }
}

export function startVersionCheck() {
  if (BUILD_ID === "dev") return;
  void checkForUpdate({ minGapMs: 0 });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkForUpdate(); });
  // Restored from the back/forward cache: the page is the old one in memory.
  window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted) void checkForUpdate({ minGapMs: 0 }); });
  window.addEventListener("focus", () => void checkForUpdate());
}

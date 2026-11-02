// Add-to-home-screen prompt logic (pure, testable). No service worker: nothing is cached.
export type Platform = "prompt" | "ios" | "none";
export const KEY = "rolff:a2hs";
export function platform(ua: string, standalone: boolean, hasPrompt: boolean): Platform {
  if (standalone) return "none";
  if (hasPrompt) return "prompt";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
  const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && safari ? "ios" : "none";
}
/** "never" = Spørg ikke igen; "later:<ms>" = Ikke nu (ask again after 7 days). */
export function shouldAsk(stored: string | null, now: number): boolean {
  if (!stored) return true;
  if (stored === "never" || stored === "installed") return false;
  const m = stored.match(/^later:(\d+)$/); return m ? now - Number(m[1]) > 7 * 864e5 : true;
}

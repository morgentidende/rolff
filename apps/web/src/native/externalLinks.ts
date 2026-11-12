// External links. No window.open/popups: a wrapped app's WebView blocks them,
// and browsers block them after an await. Links leave the app explicitly:
//  - web: a normal <a target="_blank" rel="noopener noreferrer"> (user click)
//  - native: the system browser via the Browser/App plugin, so the user can come back.
import { isNative, plugin } from "./platform";
import { isExternal } from "./core";
export { isExternal } from "./core";
/** Open an external URL outside the app. Returns false if nothing could be opened. */
export async function openExternal(url: string): Promise<boolean> {
  const browser = plugin("Browser");
  if (browser?.open && /^https?:/i.test(url)) { try { await browser.open({ url }); return true; } catch { /* fall through */ } }
  const app = plugin("AppLauncher");
  if (app?.openUrl) { try { await app.openUrl({ url }); return true; } catch { /* fall through */ } }
  if (isNative()) return false;
  const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  document.body.appendChild(a); a.click(); a.remove(); return true;
}
/** In a wrapped app, route every external <a> click to the system browser so the
 *  WebView never navigates away from Rolff. On the web this does nothing. */
export function installExternalLinkHandler(): () => void {
  if (!isNative()) return () => {};
  const click = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.hasAttribute("download") || !isExternal(a.getAttribute("href")!, location.href)) return;
    e.preventDefault(); void openExternal(a.href);
  };
  document.addEventListener("click", click, true);
  return () => document.removeEventListener("click", click, true);
}

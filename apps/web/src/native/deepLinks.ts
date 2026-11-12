// Deep links. Invitation links look like https://<app>/#invite=<token> today.
// The same parser accepts the forms a wrapped app will receive later:
//   - the same https link opened through Universal Links / App Links
//   - a custom scheme fallback: rolff://invite/<token>
//   - a path form: https://<app>/invite/<token>
// Tokens never go to history or logs; callers store them in sessionStorage only.
import { plugin } from "./platform";
import { parseDeepLink, type DeepLink } from "./core";
export { parseDeepLink, type DeepLink } from "./core";
/** Calls back for deep links that arrive while the app is already open:
 *  a changed #invite= hash on the web, or appUrlOpen in a wrapped app. */
export function onDeepLink(cb: (link: DeepLink) => void): () => void {
  const host = location.host;
  const hash = () => { const l = /#.*invite=/.test(location.hash) ? parseDeepLink(location.href, [host]) : null; if (l) { history.replaceState(history.state, "", location.pathname + location.search); cb(l); } };
  window.addEventListener("hashchange", hash);
  let handle: { remove?: () => void } | null = null; let stopped = false;
  const app = plugin("App");
  if (app?.addListener) {
    Promise.resolve(app.addListener("appUrlOpen", (e: { url?: string }) => { const l = e?.url ? parseDeepLink(e.url, [host]) : null; if (l) cb(l); }))
      .then((h: any) => { if (stopped) h?.remove?.(); else handle = h; }).catch(() => {});
  }
  return () => { stopped = true; window.removeEventListener("hashchange", hash); handle?.remove?.(); };
}

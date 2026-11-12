// Android hardware back in a wrapped app. On the web, Back already goes through
// popstate and backNavigation keeps the user inside Rolff. In a native shell the
// App plugin fires "backButton" instead: close the top window via the same
// history path, and at bare Home move the app to the background (never exit).
import { plugin } from "./platform";
import { backAction } from "./core";
export function installNativeBackButton(hasLayers: () => boolean): () => void {
  const app = plugin("App"); if (!app?.addListener) return () => {};
  let handle: { remove?: () => void } | null = null; let stopped = false;
  Promise.resolve(app.addListener("backButton", () => {
    if (backAction(hasLayers()) === "history-back") history.back(); else void app.minimizeApp?.();
  })).then((h: any) => { if (stopped) h?.remove?.(); else handle = h; }).catch(() => {});
  return () => { stopped = true; handle?.remove?.(); };
}

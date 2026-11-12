// Permissions are only ever requested right after the user taps something that
// needs them (camera button, paperclip, "turn on notifications"). Before the
// system dialog, Rolff explains in plain da/en why it asks. If the user said no
// earlier, Rolff never nags: it shows how to turn it on in the phone's settings.
import { plugin, runtime } from "./platform";
import { mapNative, type PermissionKind, type PermissionState } from "./core";
export * from "./core";
const STORE = "rolff:perm:";
export const explainedKey = (k: PermissionKind) => STORE + k;
export function markExplained(k: PermissionKind) { try { localStorage.setItem(explainedKey(k), "explained"); } catch { /* private mode */ } }
export function wasExplained(k: PermissionKind): boolean { try { return localStorage.getItem(explainedKey(k)) === "explained"; } catch { return false; } }

/** Current state without asking. Never triggers a system dialog. */
export async function queryPermission(kind: PermissionKind): Promise<PermissionState> {
  const cam = plugin("Camera");
  if (cam?.checkPermissions && kind !== "notifications") {
    try { const s = await cam.checkPermissions(); return mapNative(kind === "camera" ? s.camera : s.photos); } catch { return "prompt"; }
  }
  if (kind === "notifications") {
    const push = plugin("PushNotifications");
    if (push?.checkPermissions) { try { return mapNative((await push.checkPermissions()).receive); } catch { return "prompt"; } }
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission === "default" ? "prompt" : Notification.permission;
  }
  if (kind === "files") return runtime() === "web" ? "granted" : "prompt";
  // camera on the web: <input capture> opens the camera app; only a site-level block shows here.
  try { const s = await navigator.permissions?.query({ name: "camera" as PermissionName }); return s ? (s.state as PermissionState) : "prompt"; } catch { return "prompt"; }
}
/** Open the app's own settings page in a wrapped app (no-op on the web). */
export async function openAppSettings(): Promise<boolean> {
  const s = plugin("NativeSettings") ?? plugin("AppSettings");
  try { if (s?.open) { await s.open({ optionAndroid: "application_details", optionIOS: "app" }); return true; } } catch { /* ignore */ }
  return false;
}

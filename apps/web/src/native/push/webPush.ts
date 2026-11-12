import type { PushPermission, PushProvider, WebPushRegistration } from "./types";
/** Web Push (service worker + VAPID). `registration` is injected so the PR54
 *  worker/registration logic stays the single source of truth. */
export class WebPushProvider implements PushProvider {
  readonly platform = "web" as const;
  constructor(private registration: () => Promise<ServiceWorkerRegistration>) {}
  supported() { return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  async permission(): Promise<PushPermission> { if (!this.supported()) return "unsupported"; return Notification.permission === "default" ? "prompt" : Notification.permission; }
  async requestPermission(): Promise<PushPermission> {
    if (!this.supported()) return "unsupported";
    if (Notification.permission !== "default") return this.permission();
    const p = await Notification.requestPermission(); return p === "default" ? "prompt" : p;
  }
  async register({ vapidPublicKey, replace = false }: { vapidPublicKey?: string | null; replace?: boolean }): Promise<WebPushRegistration> {
    if (!this.supported()) throw Error("unsupported");
    if (!vapidPublicKey) throw Error("unavailable");
    if (Notification.permission !== "granted") throw Error(Notification.permission === "denied" ? "denied" : "not_granted");
    const r = await this.registration(); let sub = await r.pushManager.getSubscription();
    if (sub && replace) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidPublicKey });
    const j = sub.toJSON(); if (!j.endpoint || !j.keys?.auth || !j.keys?.p256dh) throw Error("subscription_failed");
    return { platform: "web", provider: "webpush", endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
  }
  async unregister() { if (!this.supported()) return; const r = await navigator.serviceWorker.getRegistration(); await (await r?.pushManager.getSubscription())?.unsubscribe(); }
}

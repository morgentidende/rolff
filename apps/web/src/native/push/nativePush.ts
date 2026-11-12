import { mapNative } from "../core";
import type { NativePushRegistration, PushPermission, PushProvider } from "./types";
/** Push in a wrapped app, via the Capacitor PushNotifications plugin
 *  (@capacitor/push-notifications). Not installed today: supported() is false
 *  on the web, so nothing here runs until the app is wrapped. Android gives an
 *  FCM token; iOS gives an APNs token unless Firebase Messaging is added
 *  (then pass provider "fcm"). */
type Plugin = {
  checkPermissions(): Promise<{ receive: string }>; requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>; unregister?(): Promise<void>;
  addListener(ev: string, cb: (x: any) => void): Promise<{ remove(): void }> | { remove(): void };
};
export class NativePushProvider implements PushProvider {
  constructor(readonly platform: "ios" | "android", private plugin: () => Plugin | null, private iosProvider: "apns" | "fcm" = "apns") {}
  supported() { return !!this.plugin(); }
  async permission(): Promise<PushPermission> { const p = this.plugin(); if (!p) return "unsupported"; return mapNative((await p.checkPermissions()).receive); }
  async requestPermission(): Promise<PushPermission> { const p = this.plugin(); if (!p) return "unsupported"; return mapNative((await p.requestPermissions()).receive); }
  async register(): Promise<NativePushRegistration> {
    const p = this.plugin(); if (!p) throw Error("unsupported");
    if ((await this.permission()) !== "granted") throw Error("not_granted");
    const handles: { remove(): void }[] = [];
    try {
      const token = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("register_timeout")), 15000);
        Promise.all([
          Promise.resolve(p.addListener("registration", (t: { value?: string }) => { clearTimeout(timer); t?.value ? resolve(t.value) : reject(Error("subscription_failed")); })),
          Promise.resolve(p.addListener("registrationError", () => { clearTimeout(timer); reject(Error("subscription_failed")); })),
        ]).then(h => { handles.push(...h); return p.register(); }).catch(e => { clearTimeout(timer); reject(e); });
      });
      if (!/^[A-Za-z0-9:_\-.]{20,4096}$/.test(token)) throw Error("subscription_failed");
      return { platform: this.platform, provider: this.platform === "android" ? "fcm" : this.iosProvider, token };
    } finally { handles.forEach(h => h.remove()); }
  }
  async unregister() { await this.plugin()?.unregister?.(); }
}

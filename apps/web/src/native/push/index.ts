import { plugin, runtime, type Runtime } from "../platform";
import { NativePushProvider } from "./nativePush";
import type { PushProvider } from "./types";
import { WebPushProvider } from "./webPush";
export * from "./types";
export { NativePushProvider, WebPushProvider };
/** Pick the push provider for where Rolff is running right now. */
export function pushProviderFor(r: Runtime, webRegistration: () => Promise<ServiceWorkerRegistration>): PushProvider {
  if (r === "ios" || r === "android") return new NativePushProvider(r, () => plugin("PushNotifications"));
  return new WebPushProvider(webRegistration);
}
export const currentPushProvider = (webRegistration: () => Promise<ServiceWorkerRegistration>) => pushProviderFor(runtime(), webRegistration);

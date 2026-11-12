// Runtime detection. Today Rolff only runs as a website/PWA. When it is later
// wrapped (e.g. Capacitor) the native shell exposes window.Capacitor, and every
// native-only code path below switches on automatically. No native code ships now.
import { runtimeOf, type NativeBridge, type Runtime } from "./core";
export { deviceOf, runtimeOf, type Device, type Runtime } from "./core";
export const bridge = (): NativeBridge | null => (typeof window !== "undefined" ? ((window as any).Capacitor as NativeBridge | undefined) ?? null : null);
export const runtime = (): Runtime => runtimeOf(bridge());
export const isNative = () => runtime() !== "web";
/** A native plugin by name, or null on the web / when the plugin is not installed. */
export const plugin = <T = any>(name: string): T | null => (isNative() ? (bridge()?.Plugins?.[name] as T | undefined) ?? null : null);

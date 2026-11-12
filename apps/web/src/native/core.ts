// Pure, dependency-free rules for native readiness (unit tested with Deno).
// No DOM access here; the thin wrappers in this folder do the browser/native work.
type Lang = "da" | "en";

export type Runtime = "web" | "ios" | "android";
export type NativeBridge = { getPlatform?: () => string; isNativePlatform?: () => boolean; Plugins?: Record<string, any> };
export function runtimeOf(b: NativeBridge | null): Runtime {
  if (!b || (b.isNativePlatform && !b.isNativePlatform())) return "web";
  const p = b.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}
/** Which device family the user is on, for "how to enable in settings" help. Works on web too. */
export type Device = "ios" | "android" | "desktop";
export function deviceOf(ua: string, r: Runtime = "web"): Device {
  if (r !== "web") return r;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export type DeepLink = { kind: "invite"; token: string } | { kind: "auth"; type: "recovery" | "email_change"; th: string };
const TOKEN = /^[0-9a-f]{16,128}$/;
export function parseDeepLink(raw: string, allowedHosts: string[] = []): DeepLink | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol === "https:" || u.protocol === "http:") {
    if (allowedHosts.length && !allowedHosts.includes(u.host)) return null;
  } else if (u.protocol !== "rolff:") return null;
  const q = u.searchParams, type = q.get("auth"), th = q.get("th");
  if ((type === "recovery" || type === "email_change") && th && /^[A-Za-z0-9_-]{8,256}$/.test(th)) return { kind: "auth", type, th };
  const hash = u.hash.match(/(?:^#|&)invite=([0-9a-f]{16,128})(?:&|$)/);
  if (hash) return { kind: "invite", token: hash[1] };
  // rolff://invite/<token> parses with host "invite"; https://x/invite/<token> with a path.
  const parts = (u.protocol === "rolff:" ? `${u.host}${u.pathname}` : u.pathname).split("/").filter(Boolean);
  const i = parts.lastIndexOf("invite");
  if (i >= 0 && i === parts.length - 2 && TOKEN.test(parts[i + 1])) return { kind: "invite", token: parts[i + 1] };
  return null;
}

export function isExternal(href: string, base: string): boolean {
  let u: URL; try { u = new URL(href, base); } catch { return false; }
  if (u.protocol === "mailto:" || u.protocol === "tel:") return true;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  return u.origin !== new URL(base).origin;
}

/** Android hardware back: close the top window, else background the app (never exit). */
export function backAction(hasLayers: boolean): "history-back" | "minimize" { return hasLayers ? "history-back" : "minimize"; }

export type PermissionKind = "camera" | "files" | "notifications";
export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

/** What a tap should do: open straight away, explain first, or show "turned off in settings". */
export type Next = "open" | "explain" | "denied" | "unsupported";
export function nextStep(kind: PermissionKind, state: PermissionState, explained: boolean, r: Runtime): Next {
  if (state === "unsupported") return "unsupported";
  if (state === "denied") return "denied";
  if (state === "granted") return "open";
  // On the web, the file picker needs no permission at all: the user just picks a file.
  if (kind === "files" && r === "web") return "open";
  return explained ? "open" : "explain";
}

export function mapNative(s: string | undefined): PermissionState {
  return s === "granted" || s === "limited" ? "granted" : s === "denied" ? "denied" : "prompt";
}

const COPY: Record<PermissionKind, Record<Lang, { title: string; body: string; allow: string }>> = {
  camera: {
    da: { title: "Rolff vil gerne bruge kameraet", body: "Så kan du tage et billede og sende det i samtalen. Rolff bruger kun kameraet, når du selv trykker på kameraknappen, og billedet tjekkes før det sendes. Din telefon spørger dig nu om lov.", allow: "Fortsæt" },
    en: { title: "Rolff would like to use the camera", body: "So you can take a photo and send it in the conversation. Rolff only uses the camera when you tap the camera button, and the photo is checked before it is sent. Your phone will now ask for permission.", allow: "Continue" },
  },
  files: {
    da: { title: "Vælg et billede eller en fil", body: "Du vælger selv, hvilket billede eller hvilken fil du vil sende. Rolff ser kun den fil, du vælger – aldrig resten af dine billeder eller filer.", allow: "Fortsæt" },
    en: { title: "Choose a photo or file", body: "You choose which photo or file to send. Rolff only sees the file you pick – never the rest of your photos or files.", allow: "Continue" },
  },
  notifications: {
    da: { title: "Vil du have besked, når der kommer en ny besked?", body: "Notifikationen siger kun, at der er en ny besked i Rolff – aldrig hvem den er fra eller hvad der står. Du kan slå det fra igen når som helst.", allow: "Slå til" },
    en: { title: "Get notified about new messages?", body: "The notification only says there is a new message in Rolff – never who it is from or what it says. You can turn it off at any time.", allow: "Turn on" },
  },
};
export const permissionCopy = (k: PermissionKind, lang: Lang) => ({ ...COPY[k][lang], later: lang === "da" ? "Ikke nu" : "Not now" });

const WHAT: Record<PermissionKind, Record<Lang, string>> = {
  camera: { da: "kameraet", en: "the camera" },
  files: { da: "billeder og filer", en: "photos and files" },
  notifications: { da: "notifikationer", en: "notifications" },
};
const SETTING: Record<PermissionKind, Record<Lang, string>> = {
  camera: { da: "Kamera", en: "Camera" },
  files: { da: "Fotos", en: "Photos" },
  notifications: { da: "Notifikationer", en: "Notifications" },
};
/** "Turned off" help: title + numbered steps for the user's own device. */
export function deniedHelp(kind: PermissionKind, device: Device, r: Runtime, lang: Lang): { title: string; steps: string[] } {
  const da = lang === "da"; const what = WHAT[kind][lang]; const s = SETTING[kind][lang];
  const title = da ? `Adgang til ${what} er slået fra` : `Access to ${what} is turned off`;
  let steps: string[];
  if (r === "ios") steps = da ? ["Åbn Indstillinger på din iPhone.", "Rul ned og tryk på Rolff.", `Slå ${s} til.`, "Gå tilbage til Rolff og prøv igen."] : ["Open Settings on your iPhone.", "Scroll down and tap Rolff.", `Turn on ${s}.`, "Return to Rolff and try again."];
  else if (r === "android") steps = da ? ["Åbn Indstillinger på din telefon.", "Tryk på Apps, og vælg Rolff.", `Tryk på Tilladelser (eller ${s}), og tillad ${what}.`, "Gå tilbage til Rolff og prøv igen."] : ["Open Settings on your phone.", "Tap Apps and choose Rolff.", `Tap Permissions (or ${s}) and allow ${what}.`, "Return to Rolff and try again."];
  else if (device === "ios") steps = kind === "notifications"
    ? (da ? ["Rolff skal være føjet til hjemmeskærmen (iOS 16.4 eller nyere).", "Åbn Indstillinger › Notifikationer › Rolff.", "Slå Tillad notifikationer til."] : ["Rolff must be added to the Home Screen (iOS 16.4 or later).", "Open Settings › Notifications › Rolff.", "Turn on Allow Notifications."])
    : (da ? ["Åbn Indstillinger › Safari › Kamera (under Indstillinger for websteder).", "Vælg Spørg eller Tillad.", "Gå tilbage til Rolff og prøv igen."] : ["Open Settings › Safari › Camera (under Settings for Websites).", "Choose Ask or Allow.", "Return to Rolff and try again."]);
  else if (device === "android") steps = da ? ["Tryk på ikonet til venstre for adressen (eller hold Rolff-ikonet nede og vælg App-info).", `Tryk på Tilladelser, og tillad ${what}.`, "Genindlæs Rolff og prøv igen."] : ["Tap the icon left of the address (or long-press the Rolff icon and choose App info).", `Tap Permissions and allow ${what}.`, "Reload Rolff and try again."];
  else steps = da ? ["Klik på ikonet til venstre for adressen i browseren.", `Tillad ${what} for denne side.`, "Genindlæs siden og prøv igen."] : ["Click the icon left of the address in your browser.", `Allow ${what} for this site.`, "Reload the page and try again."];
  return { title, steps };
}
export const unsupportedText = (kind: PermissionKind, lang: Lang) => lang === "da"
  ? (kind === "notifications" ? "Notifikationer virker ikke i denne browser. På iPhone skal Rolff føjes til hjemmeskærmen (iOS 16.4 eller nyere)." : `Denne browser kan ikke bruge ${WHAT[kind].da}.`)
  : (kind === "notifications" ? "Notifications do not work in this browser. On iPhone, add Rolff to the Home Screen (iOS 16.4 or later)." : `This browser cannot use ${WHAT[kind].en}.`);



export type PushPlatform = "web" | "ios" | "android";
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";
export type WebPushRegistration = { platform: "web"; provider: "webpush"; endpoint: string; keys: { p256dh: string; auth: string } };
export type NativePushRegistration = { platform: "ios" | "android"; provider: "fcm" | "apns"; token: string };
export type PushRegistration = WebPushRegistration | NativePushRegistration;
export interface PushProvider {
  readonly platform: PushPlatform;
  supported(): boolean;
  /** Current permission, never asks. */
  permission(): Promise<PushPermission>;
  /** Shows the system prompt. Call only from a user tap (after the in-app explanation). */
  requestPermission(): Promise<PushPermission>;
  /** Get (or renew) this device's push address. Requires permission "granted". */
  register(opts: { vapidPublicKey?: string | null; replace?: boolean }): Promise<PushRegistration>;
  /** Forget this device's push address locally. The server copy is revoked separately. */
  unregister(): Promise<void>;
}
/** The RPC + arguments that store a registration on the server. */
export function saveCall(reg: PushRegistration, previous: string | null = null): { name: string; args: Record<string, unknown> } {
  if (reg.platform === "web") return { name: "save_my_push", args: { p_endpoint: reg.endpoint, p_p256dh: reg.keys.p256dh, p_auth: reg.keys.auth, p_previous: previous } };
  return { name: "save_my_device_token", args: { p_platform: reg.platform, p_provider: reg.provider, p_token: reg.token, p_previous: previous } };
}
export function revokeCall(platform: PushPlatform, id: string | null, all = false): { name: string; args: Record<string, unknown> } {
  return platform === "web" ? { name: "revoke_my_push", args: { p_id: id, p_all: all } } : { name: "revoke_my_device_token", args: { p_id: id, p_all: all } };
}

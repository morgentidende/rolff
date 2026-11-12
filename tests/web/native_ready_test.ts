import { assert, assertEquals } from "jsr:@std/assert@1";
import { backAction, deniedHelp, deviceOf, isExternal, mapNative, nextStep, parseDeepLink, permissionCopy, revokeCall, runtimeOf, saveCall, unsupportedText, type PermissionKind } from "../../apps/web/src/native/core.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const APP = "yellowgreen-lobster-916967.hostingersite.com";

Deno.test("runtime: web unless a native bridge says ios/android", () => {
  assertEquals(runtimeOf(null), "web");
  assertEquals(runtimeOf({ getPlatform: () => "web", isNativePlatform: () => false }), "web");
  assertEquals(runtimeOf({ getPlatform: () => "ios", isNativePlatform: () => true }), "ios");
  assertEquals(runtimeOf({ getPlatform: () => "android", isNativePlatform: () => true }), "android");
  assertEquals(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assertEquals(deviceOf("Mozilla/5.0 (Linux; Android 14)"), "android");
  assertEquals(deviceOf("Mozilla/5.0 (X11; Linux x86_64)"), "desktop");
  assertEquals(deviceOf("Mozilla/5.0 (X11; Linux x86_64)", "ios"), "ios");
});

Deno.test("deep links: invitation forms a wrapped app will receive", () => {
  assertEquals(parseDeepLink(`https://${APP}/#invite=${TOKEN}`, [APP]), { kind: "invite", token: TOKEN });
  assertEquals(parseDeepLink(`https://${APP}/?source=pwa#invite=${TOKEN}`, [APP]), { kind: "invite", token: TOKEN });
  assertEquals(parseDeepLink(`https://${APP}/invite/${TOKEN}`, [APP]), { kind: "invite", token: TOKEN });
  assertEquals(parseDeepLink(`rolff://invite/${TOKEN}`), { kind: "invite", token: TOKEN });
  assertEquals(parseDeepLink(`https://${APP}/?auth=recovery&th=abcdefgh123`, [APP]), { kind: "auth", type: "recovery", th: "abcdefgh123" });
  assertEquals(parseDeepLink(`https://evil.example/#invite=${TOKEN}`, [APP]), null);
  assertEquals(parseDeepLink(`https://${APP}/#invite=notatoken`, [APP]), null);
  assertEquals(parseDeepLink(`https://${APP}/?auth=signup&th=abcdefgh123`, [APP]), null);
  assertEquals(parseDeepLink(`javascript:alert(1)#invite=${TOKEN}`), null);
  assertEquals(parseDeepLink("not a url"), null);
});

Deno.test("external links: only other origins, mailto and tel leave the app", () => {
  const base = `https://${APP}/`;
  assert(isExternal("https://www.datatilsynet.dk/", base));
  assert(isExternal("mailto:kontakt@example.invalid", base));
  assert(!isExternal("./privatliv.html", base));
  assert(!isExternal(`https://${APP}/tjek.html`, base));
  assert(!isExternal("blob:https://x/1", base));
  assert(!isExternal("javascript:void(0)", base));
});

Deno.test("android back: close the top window, else go to background (never exit)", () => {
  assertEquals(backAction(true), "history-back");
  assertEquals(backAction(false), "minimize");
});

Deno.test("permissions: ask only on a tap, explain first, never nag after a no", () => {
  assertEquals(nextStep("camera", "prompt", false, "web"), "explain");
  assertEquals(nextStep("camera", "prompt", true, "web"), "open");
  assertEquals(nextStep("camera", "granted", false, "android"), "open");
  assertEquals(nextStep("camera", "denied", true, "ios"), "denied");
  assertEquals(nextStep("files", "prompt", false, "web"), "open");
  assertEquals(nextStep("files", "prompt", false, "ios"), "explain");
  assertEquals(nextStep("notifications", "unsupported", false, "web"), "unsupported");
  assertEquals(nextStep("notifications", "prompt", false, "web"), "explain");
  assertEquals(mapNative("limited"), "granted");
  assertEquals(mapNative("prompt-with-rationale"), "prompt");
});

Deno.test("permissions: every text exists in da and en", () => {
  const kinds: PermissionKind[] = ["camera", "files", "notifications"];
  for (const k of kinds) {
    const da = permissionCopy(k, "da"), en = permissionCopy(k, "en");
    for (const c of [da, en]) assert(c.title && c.body && c.allow && c.later);
    assert(da.body !== en.body && da.later === "Ikke nu" && en.later === "Not now");
    for (const r of ["web", "ios", "android"] as const) for (const d of ["ios", "android", "desktop"] as const) {
      const hda = deniedHelp(k, d, r, "da"), hen = deniedHelp(k, d, r, "en");
      assert(hda.steps.length >= 2 && hda.steps.length === hen.steps.length, `${k}/${r}/${d}`);
      assert(hda.title !== hen.title);
    }
    assert(unsupportedText(k, "da") !== unsupportedText(k, "en"));
  }
  assert(deniedHelp("camera", "ios", "ios", "da").steps.some(s => s.includes("Kamera")));
  assert(deniedHelp("notifications", "ios", "web", "en").steps[0].includes("Home Screen"));
});

Deno.test("push: one interface, web today, native tokens with platform later", () => {
  const idx = Deno.readTextFileSync(new URL("../../apps/web/src/native/push/index.ts", import.meta.url));
  assert(idx.includes("new NativePushProvider(r") && idx.includes("new WebPushProvider("));
  assertEquals(saveCall({ platform: "web", provider: "webpush", endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "B", auth: "a" } }).name, "save_my_push");
  assertEquals(saveCall({ platform: "android", provider: "fcm", token: "t".repeat(30) }, "prev"), { name: "save_my_device_token", args: { p_platform: "android", p_provider: "fcm", p_token: "t".repeat(30), p_previous: "prev" } });
  assertEquals(revokeCall("ios", null, true), { name: "revoke_my_device_token", args: { p_id: null, p_all: true } });
  assertEquals(revokeCall("web", "x").name, "revoke_my_push");
});

Deno.test("no popups: the web app never calls window.open, alert, confirm or prompt", () => {
  const dir = new URL("../../apps/web/src/", import.meta.url);
  const walk = (u: URL): string[] => [...Deno.readDirSync(u)].flatMap(e => e.isDirectory ? walk(new URL(e.name + "/", u)) : /\.tsx?$/.test(e.name) ? [new URL(e.name, u).pathname] : []);
  for (const f of walk(dir)) {
    const src = Deno.readTextFileSync(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert(!/window\.open\s*\(|(?<![.\w])(alert|confirm|prompt)\s*\(|window\.(alert|confirm|prompt)\s*\(/.test(src), `popup API in ${f}`);
  }
});

Deno.test("safe areas: viewport-fit=cover and inset padding are in place", () => {
  const html = Deno.readTextFileSync(new URL("../../apps/web/index.html", import.meta.url));
  assert(html.includes("viewport-fit=cover"));
  const css = Deno.readTextFileSync(new URL("../../apps/web/src/native.css", import.meta.url));
  for (const side of ["top", "left", "right", "bottom"]) assert(css.includes(`env(safe-area-inset-${side})`), side);
  const main = Deno.readTextFileSync(new URL("../../apps/web/src/main.tsx", import.meta.url));
  assert(main.includes('import "./native.css"') && main.includes("installNativeBackButton") && main.includes("installExternalLinkHandler"));
});

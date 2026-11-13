import { assertEquals } from "jsr:@std/assert@1";
import { platform, shouldAsk } from "../../apps/web/src/install.ts";
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME = IOS.replace("Version/18.0", "CriOS/130.0");
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
Deno.test("install prompt platform", () => {
  assertEquals(platform(IOS, false, false), "ios");
  assertEquals(platform(IOS, true, false), "none");
  assertEquals(platform(IOS_CHROME, false, false), "none");
  assertEquals(platform(ANDROID, false, true), "prompt");
  assertEquals(platform(ANDROID, false, false), "none");
  assertEquals(platform(ANDROID, true, true), "none");
});
Deno.test("install prompt memory", () => {
  const now = 1_800_000_000_000;
  assertEquals(shouldAsk(null, now), true);
  assertEquals(shouldAsk("never", now), false);
  assertEquals(shouldAsk("installed", now), false);
  assertEquals(shouldAsk(`later:${now - 864e5}`, now), false);
  assertEquals(shouldAsk(`later:${now - 8 * 864e5}`, now), true);
});

Deno.test("front-page download pill stays visible in the installed webapp", async () => {
  const a = await Deno.readTextFile("apps/web/src/App.tsx");
  if (a.includes('if (isNative() || standalone || localStorage.getItem(A2HS_KEY) === "installed") return null;')) {
    throw new Error("Download webapp pill is still hidden in standalone / after install");
  }
  if (!a.includes('if (isNative()) return null;')) throw new Error("native app should still hide the pill");
  if (!a.includes('if (standalone) { setGuide("installed"); return; }')) throw new Error("standalone tap should open the already-installed sheet");
  if (!a.includes("Rolff er allerede installeret på din hjemmeskærm.")) throw new Error("missing Danish already-installed copy");
  if (!a.includes("Rolff is already installed on your home screen.")) throw new Error("missing English already-installed copy");
});

import { assert, assertEquals } from "jsr:@std/assert@1";
import { shouldReload } from "../../apps/web/src/versionPolicy.ts";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

Deno.test("reloads once when a newer build is live", () => {
  const s = mem();
  assertEquals(shouldReload("b1", "b2", s, false), true);
  s.setItem("rolff:reloaded-for-build", "b2"); // set by checkForUpdate before reloading
  assertEquals(shouldReload("b1", "b2", s, false), false, "loop guard: never twice for the same live build");
  assertEquals(shouldReload("b1", "b3", s, false), true, "an even newer build may reload again");
});
Deno.test("no reload when up to date, in dev, on bad data, or while sending", () => {
  const s = mem();
  assertEquals(shouldReload("b1", "b1", s, false), false);
  assertEquals(shouldReload("dev", "b2", s, false), false);
  assertEquals(shouldReload("b1", null, s, false), false);
  assertEquals(shouldReload("b1", 42 as unknown as string, s, false), false);
  assertEquals(shouldReload("b1", "b2", s, true), false, "blocked while a message/attachment is being sent");
  assertEquals(shouldReload("b1", "b2", null, false), true, "works without sessionStorage");
});
Deno.test("guard is cleared once the new build is running", () => {
  const s = mem(); s.setItem("rolff:reloaded-for-build", "b2");
  shouldReload("b2", "b2", s, false);
  assertEquals(s.getItem("rolff:reloaded-for-build"), null);
});
Deno.test("server rules: HTML/manifest/version.json revalidate, hashed assets immutable", () => {
  const root = Deno.readTextFileSync("apps/web/public/.htaccess");
  assert(/FilesMatch "\\\.\(html\|webmanifest\|json\)\$"/.test(root));
  assert(root.includes('Header set Cache-Control "no-cache, must-revalidate"'));
  const assets = Deno.readTextFileSync("apps/web/public/assets/.htaccess");
  assert(assets.includes('Header set Cache-Control "public, max-age=31536000, immutable"'));
  const vite = Deno.readTextFileSync("apps/web/vite.config.ts");
  assert(vite.includes('fileName: "version.json"') && vite.includes("__ROLFF_BUILD__"));
  assert(Deno.readTextFileSync("apps/web/src/main.tsx").includes("startVersionCheck()"));
});

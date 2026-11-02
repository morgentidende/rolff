import { assertEquals } from "jsr:@std/assert@1";
import { appUrl, DEFAULT_APP_URL, inviteLink } from "../../supabase/functions/_shared/links.ts";
const env = (v?: string) => ({ get: (k: string) => (k === "APP_URL" ? v : undefined) });
Deno.test("links default to the web app", () => {
  assertEquals(appUrl(env()), DEFAULT_APP_URL);
  assertEquals(appUrl(env("javascript:alert(1)")), DEFAULT_APP_URL);
  assertEquals(inviteLink("ab12", env()), "https://yellowgreen-lobster-916967.hostingersite.com/#invite=ab12");
  assertEquals(appUrl(env("https://app.example.dk")), "https://app.example.dk/");
});

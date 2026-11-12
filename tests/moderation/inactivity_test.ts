import { assert, assertEquals } from "jsr:@std/assert@1";
import { inactivityMail } from "../../supabase/functions/_shared/email.ts";
const allowed = (email: string, env: string, allow: string) => env === "production" || (!!allow && new RegExp(allow, "i").test(email));
Deno.test("test-miljø: kun bot-indbakke tilladt", () => {
  const re = "^morgentidende-rapport(\\+[a-z0-9-]+)?@mail\\.grokbot\\.com$";
  assert(allowed("morgentidende-rapport+inact@mail.grokbot.com", "test", re));
  assert(!allowed("nicolaipetersen108@gmail.com", "test", re));
  assert(!allowed("someone@example.com", "test", ""));
});
Deno.test("advarselsmail uden indhold", () => {
  const m = inactivityMail({ link: "https://x" });
  assertEquals(/besked:|body/i.test(m.text), false);
  assert(m.text.includes("14 dage"));
});

Deno.test("advarselsmail på engelsk er stadig uden indhold", () => {
  const m = inactivityMail({ link: "https://x", lang: "en" });
  assertEquals(/besked:|body/i.test(m.text), false);
  assert(m.text.includes("14 days"));
  assert(m.html.startsWith('<!doctype html><html lang="en">'));
});

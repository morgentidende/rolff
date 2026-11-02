import { allowed, authLink, EMAIL } from "../../supabase/functions/_shared/authmail.ts";
import { recoveryMail, emailChangeMail } from "../../supabase/functions/_shared/email.ts";
Deno.test("account-mail: link, allow-list, mails", () => {
  const l = authLink("https://x.example/", "recovery", "ab&c");
  if (l !== "https://x.example/?auth=recovery&th=ab%26c") throw new Error(l);
  if (allowed("someone@gmail.com", "test", "^morgentidende-rapport\\+.*@mail\\.grokbot\\.com$")) throw new Error("allow");
  if (!allowed("morgentidende-rapport+a@mail.grokbot.com", "test", "^morgentidende-rapport\\+.*@mail\\.grokbot\\.com$")) throw new Error("allow2");
  if (allowed("a@b.dk", "test", "")) throw new Error("empty allow");
  if (!EMAIL.test("a@b.dk") || EMAIL.test("a b@c.dk")) throw new Error("email");
  const r = recoveryMail({ link: l }); if (!r.html.includes("auth=recovery&amp;th=ab%26c") || !r.text.includes(l)) throw new Error("mail");
  const c = emailChangeMail({ link: l, current: true, newEmail: "<x>@y.dk" }); if (c.html.includes("<x>")) throw new Error("esc");
});

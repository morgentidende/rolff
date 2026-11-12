// Forgot password + change e-mail. Mails go through our own PHP mailer (not Supabase SMTP).
// POST {action:"recover", email}                 – no login; always answers {ok:true} (no account enumeration)
// POST {action:"change_email", password, new_email} – logged in; re-auth with password, checks the new
//      address for provocative content (address_rejected / check_unavailable, fail closed), then mails
//      a confirmation link to the NEW address (proves ownership) and a notice without link to the
//      current address. The account owner is proven by the password. (Admin-generated "current" links
//      were found to switch the e-mail on their own, without the new address confirming – so not used.)
// Links point to APP_URL?auth=<type>&th=<token_hash>; the app calls verifyOtp. Rate limited per address.
// Outside APP_ENV=production only addresses matching TEST_MAIL_ALLOW get mail. Logs never contain addresses.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { crypto as stdCrypto } from "jsr:@std/crypto@1";
import { authed, cors, json } from "../_shared/http.ts";
import { recoveryMail, emailChangeMail, sendMail, preferLang, storedLang } from "../_shared/email.ts";
import { allowed, authLink, EMAIL } from "../_shared/authmail.ts";
import { appUrl } from "../_shared/links.ts";
import { checkAddress } from "../_shared/addressCheck.ts";
import { timeoutFromEnv } from "../_shared/moderation.ts";
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s.trim().toLowerCase())))].map((b) => b.toString(16).padStart(2, "0")).join("");
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  // DEMO_OPEN_MAIL=1: hosted demo may mail any address (rate limits still apply).
  const env = Deno.env.get("DEMO_OPEN_MAIL") === "1" ? "production" : (Deno.env.get("APP_ENV") ?? "test"), allow = Deno.env.get("TEST_MAIL_ALLOW") ?? "", app = appUrl();
  if (i?.action === "recover") {
    const email = String(i?.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return json({ error: "bad_input" }, 400);
    const a = admin();
    const ok = await a.rpc("auth_mail_allow", { p_hash: await sha(email), p_kind: "recovery" });
    if (ok.data === true && allowed(email, env, allow)) {
      const g = await a.auth.admin.generateLink({ type: "recovery", email });
      const h = g.data?.properties?.hashed_token;
      const lang = preferLang(i?.lang, await storedLang((n, args) => a.rpc(n, args), { uid: g.data?.user?.id, email }));
      if (h && !(await sendMail(email, recoveryMail({ link: authLink(app, "recovery", h), lang })))) console.log(JSON.stringify({ evt: "recovery_mail_failed" }));
    }
    return json({ data: { ok: true } }); // same answer whether or not the account exists
  }
  if (i?.action === "change_email") {
    const u = await authed(req); if (u instanceof Response) return u;
    const pw = String(i?.password ?? ""), next = String(i?.new_email ?? "").trim().toLowerCase();
    if (!pw || !EMAIL.test(next) || next.length > 254) return json({ error: "bad_input" }, 400);
    const { data: me } = await u.admin.auth.admin.getUserById(u.uid);
    const cur = me.user?.email ?? "";
    if (!cur || cur === next) return json({ error: "bad_input" }, 400);
    const pub = Deno.env.get("SUPABASE_ANON_KEY") || JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default;
    const check = await createClient(Deno.env.get("SUPABASE_URL")!, pub, { auth: { persistSession: false } }).auth.signInWithPassword({ email: cur, password: pw });
    if (check.error || check.data.user?.id !== u.uid) return json({ error: "wrong_password" }, 403);
    if (!(await u.admin.rpc("auth_mail_allow", { p_hash: await sha(cur), p_kind: "email_change" })).data) return json({ error: "rate_limited" }, 429);
    if (!allowed(cur, env, allow) || !allowed(next, env, allow)) return json({ error: "test_mail_blocked" }, 403);
    // The e-mail is the name others see: refuse provocative/insulting addresses (word filter, then Luna).
    // Fails closed: no confirmation is sent if the check cannot be completed. The address is never logged.
    try {
      if (await checkAddress(Deno.env, next, Math.min(8000, timeoutFromEnv(Deno.env))) === "block") return json({ error: "address_rejected" }, 422);
    } catch { console.log(JSON.stringify({ evt: "address_check_unavailable" })); return json({ error: "check_unavailable" }, 503); }
    const gn = await u.admin.auth.admin.generateLink({ type: "email_change_new", email: cur, newEmail: next });
    const otp = gn.data?.properties?.email_otp;
    if (!otp) return json({ error: /already|exists|registered/i.test(gn.error?.message ?? "") ? "email_taken" : "failed" }, 400);
    // GoTrue stores the new-address token as sha224(new_email + otp); verifyOtp(token_hash) matches on that.
    const th = [...new Uint8Array(await stdCrypto.subtle.digest("SHA-224", new TextEncoder().encode(next + otp)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const lang = preferLang(i?.lang, await storedLang((n, args) => u.admin.rpc(n, args), { uid: u.uid }));
    const m2 = await sendMail(next, emailChangeMail({ link: authLink(app, "email_change", th), current: false, newEmail: next, lang }));
    const m1 = await sendMail(cur, emailChangeMail({ link: "", current: true, newEmail: next, lang }));
    if (!m1 || !m2) { console.log(JSON.stringify({ evt: "email_change_mail_failed" })); return json({ error: "mail_failed" }, 502); }
    return json({ data: { sent: true } });
  }
  return json({ error: "bad_input" }, 400);
});

// Daily, called by pg_cron (pg_net) with header x-cron-secret. Sends a content-free warning mail,
// then deletes accounts still inactive after the grace period. In test (APP_ENV != "production")
// mail and deletion only touch allow-listed test addresses (TEST_MAIL_ALLOW regex), never real users.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
import { inactivityMail, sendMail, storedLang } from "../_shared/email.ts";
import { appUrl } from "../_shared/links.ts";
export const allowed = (email: string, env: string, allow: string) =>
  env === "production" || (!!allow && new RegExp(allow, "i").test(email));
Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))[0] as string;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const env = Deno.env.get("APP_ENV") ?? "test", allow = Deno.env.get("TEST_MAIL_ALLOW") ?? "";
  const { data, error } = await admin.rpc("inactivity_sweep");
  if (error) { console.log("inactivity-sweep: rpc failed"); return json({ error: "failed" }, 500); }
  let warned = 0, deleted = 0, skipped = 0;
  for (const r of (data ?? []) as { user_id: string; email: string; action: string }[]) {
    if (!allowed(r.email ?? "", env, allow)) { skipped++; continue; }
    if (r.action === "warn") {
      const lang = await storedLang((n, args) => admin.rpc(n, args), { uid: r.user_id });
      if (await sendMail(r.email, inactivityMail({ link: appUrl(), lang }))) warned++;
    }
    else if (r.action === "delete") {
      const p = await admin.rpc("purge_user_content", { p_uid: r.user_id });
      if (!p.error && !(await admin.auth.admin.deleteUser(r.user_id)).error) deleted++;
    }
  }
  const rs = await admin.rpc("retention_sweep");
  const expired = rs.error ? -1 : (rs.data as number);
  console.log(`inactivity-sweep: warned=${warned} deleted=${deleted} skipped=${skipped} expired_messages=${expired}`);
  return json({ data: { warned, deleted, skipped, expired } });
});

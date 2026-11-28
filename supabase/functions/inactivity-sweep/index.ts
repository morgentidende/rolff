// Daily, called by pg_cron (pg_net) with header x-cron-secret.
// Account inactivity deletion has been removed. This job runs retention_sweep() (physically deletes a message once it is
// older than every active member's retention; the default is "keep until the user deletes them") and sends the one
// warning (mail; the push is queued by the database) 3 days before a shorter retention would hide the first messages.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
import { sendMail } from "../_shared/email.ts";
import { runRetentionWarnings } from "../_shared/retentionWarn.ts";
export const allowed = (email: string, env: string, allow: string) =>
  env === "production" || (!!allow && new RegExp(allow, "i").test(email));
Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))[0] as string;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const rs = await admin.rpc("retention_sweep");
  const expired = rs.error ? -1 : (rs.data as number);
  console.log(`inactivity-sweep: retention only, expired_messages=${expired}`);
  const env = Deno.env.get("APP_ENV") ?? "test", allow = Deno.env.get("TEST_MAIL_ALLOW") ?? "";
  let w = { claimed: 0, mailed: 0, skipped: 0, released: 0 };
  try {
    w = await runRetentionWarnings({ rpc: (n, a) => admin.rpc(n, a), send: sendMail, allowed: (e) => allowed(e, env, allow) });
  } catch { /* the sweep result must not depend on the warning step */ }
  console.log(`inactivity-sweep: warnings claimed=${w.claimed} mailed=${w.mailed} skipped=${w.skipped} released=${w.released}`);
  return json({ data: { warned: w.mailed, deleted: 0, skipped: w.skipped, expired } });
});

// Daily, called by pg_cron (pg_net) with header x-cron-secret.
// Account inactivity deletion has been removed. This job only runs retention_sweep()
// (physically deletes a message once it is older than every active member's retention).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
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
  return json({ data: { warned: 0, deleted: 0, skipped: 0, expired } });
});

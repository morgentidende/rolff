// Public: POST {code?, sha256?} -> {status: "match"|"code_valid"|"mismatch", created_at, period_from,
// period_to, partial, message_count, page_count}. Never returns content, names, e-mails or ids.
// The PDF itself is never uploaded: the browser computes its SHA-256. Rate limited per hashed IP.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/http.ts";
const hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, "0")).join("");
function serverKey() { try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? ""); return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || o?.default || Object.values(o ?? {})[0] as string; } catch { return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; } }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const code = typeof i?.code === "string" ? i.code.slice(0, 64) : null, sha = typeof i?.sha256 === "string" ? i.sha256.slice(0, 64) : null;
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), { auth: { persistSession: false } });
  const r = await admin.rpc("verify_conversation_export", { p_ip_hash: await hex(`${Deno.env.get("VERIFY_IP_SALT") ?? "rolff-verify"}:${ip}`), p_code: code, p_sha: sha });
  if (r.error) { const rl = /rate_limited/.test(r.error.message); return json({ error: rl ? "rate_limited" : /bad_input/.test(r.error.message) ? "bad_input" : "verify_failed" }, rl ? 429 : 400); }
  const row = (r.data as any[])?.[0] ?? { status: "mismatch" };
  return json({ data: row });
});

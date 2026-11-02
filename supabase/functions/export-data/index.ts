// POST {password} -> the caller's OWN data (GDPR art. 15) as JSON. Requires re-authentication and is
// rate limited (3 per 24h, in SQL). Messages come via the caller's own JWT (get_messages rules), so
// nothing the caller cannot see in the app is included. The files (JSON/CSV/ZIP) are built on the device.
// Logs never contain content.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authed, cors, json } from "../_shared/http.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const password = String(i?.password ?? "");
  if (!password) return json({ error: "password_required" }, 400);
  const { data: u } = await a.admin.auth.admin.getUserById(a.uid);
  const email = u.user?.email; if (!email) return json({ error: "unauthenticated" }, 401);
  const pub = Deno.env.get("SUPABASE_ANON_KEY") || Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"))[0] as string;
  const check = createClient(Deno.env.get("SUPABASE_URL")!, pub, { auth: { persistSession: false } });
  const s = await check.auth.signInWithPassword({ email, password });
  if (s.error || s.data.user?.id !== a.uid) return json({ error: "wrong_password" }, 403);
  const base = await a.admin.rpc("export_user_data", { p_uid: a.uid });
  if (base.error) return json({ error: /rate_limited/.test(base.error.message) ? "rate_limited" : "export_failed" }, /rate_limited/.test(base.error.message) ? 429 : 500);
  const convs = await a.user.rpc("list_my_conversations");
  const conversations = [];
  for (const c of (convs.data ?? []) as { id: string; others: unknown }[]) {
    const m = await a.user.rpc("get_messages", { conv: c.id });
    conversations.push({ conversation_id: c.id, participants_as_shown_to_you: c.others, messages: (m.data ?? []).map((x: any) => ({ id: x.id, from: x.mine ? "me" : x.sender_name, sent_by_me: x.mine, created_at: x.created_at, text: x.body })) });
  }
  console.log("export-data: done");
  return json({ data: { generated_at: new Date().toISOString(), format_version: 1, ...(base.data as object), conversations } });
});

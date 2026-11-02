// POST {password} -> deletes the caller's account (art. 17). Requires re-authentication.
// Removes only the caller's own data; the counterpart's copy of the conversation is kept unchanged.
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
  const p = await a.admin.rpc("purge_user_content", { p_uid: a.uid });
  if (p.error) { console.log("delete-account: purge failed"); return json({ error: "delete_failed" }, 500); }
  const d = await a.admin.auth.admin.deleteUser(a.uid);
  if (d.error) { console.log("delete-account: auth delete failed"); return json({ error: "delete_failed" }, 500); }
  console.log("delete-account: done");
  return json({ data: { deleted: true } });
});

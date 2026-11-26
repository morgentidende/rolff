// POST {password, email_transcript?, lang?} -> deletes the caller's account (art. 17). Requires re-authentication.
// When email_transcript is true, a full transcript of all conversations is e-mailed to the account
// address first; deletion is aborted if that mail cannot be queued. Removes only the caller's own
// data; the counterpart's copy of the conversation is kept unchanged. Logs never contain content.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authed, cors, json } from "../_shared/http.ts";
import { sendMail, type MailLang } from "../_shared/email.ts";
import { sendAccountTranscript } from "../_shared/accountTranscript.ts";
import { runDeleteAccount } from "../_shared/deleteAccount.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const r = await runDeleteAccount(i, {
    getEmail: async () => (await a.admin.auth.admin.getUserById(a.uid)).data.user?.email ?? null,
    checkPassword: async (email, password) => {
      const pub = Deno.env.get("SUPABASE_ANON_KEY") || Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"))[0] as string;
      const check = createClient(Deno.env.get("SUPABASE_URL")!, pub, { auth: { persistSession: false } });
      const s = await check.auth.signInWithPassword({ email, password });
      return !s.error && s.data.user?.id === a.uid;
    },
    sendTranscript: (email: string, lang: MailLang) => sendAccountTranscript({ email, lang }, {
      listConversations: () => a.user.rpc("list_my_conversations"),
      getMessages: (conv) => a.user.rpc("get_messages", { conv }),
      mail: sendMail,
    }),
    purge: async () => { const p = await a.admin.rpc("purge_user_content", { p_uid: a.uid }); return !p.error; },
    deleteAuth: async () => { const d = await a.admin.auth.admin.deleteUser(a.uid); return !d.error; },
  });
  // Status / error code only, never addresses or content.
  const outcome = r.status === 200 ? "done" : String(r.body.error);
  console.log("delete-account: " + outcome);
  return json(r.body, r.status);
});

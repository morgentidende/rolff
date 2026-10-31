// POST {action:"create", conversation_id, role} | {action:"accept", token} | {action:"revoke", invitation_id} | {action:"consent", invitation_id}
// Runs as the calling user (RLS + SECURITY DEFINER RPCs enforce rules). Errors are generic.
import { authed, cors, json } from "../_shared/http.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  const { user } = a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  let r;
  switch (i?.action) {
    case "create": r = await user.rpc("create_invitation", { conv: i.conversation_id, p_role: i.role ?? "parent" }); break;
    case "accept": r = await user.rpc("accept_invitation", { p_token: String(i.token ?? "") }); break;
    case "revoke": r = await user.rpc("revoke_invitation", { inv: i.invitation_id }); break;
    case "consent": r = await user.rpc("consent_invitation", { inv: i.invitation_id }); break;
    default: return json({ error: "bad_request" }, 400);
  }
  if (r.error) {
    const m = r.error.message;
    const code = /consent_missing/.test(m) ? "consent_missing" : /parents_full/.test(m) ? "parents_full" : "invalid_invitation";
    return json({ error: code }, 400);
  }
  return json({ data: Array.isArray(r.data) ? r.data[0] : r.data });
});

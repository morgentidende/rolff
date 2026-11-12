// POST {conversation_id, recipient: "self"|"other", email?, from?: YYYY-MM-DD, to?: YYYY-MM-DD, time_zone?, confirm: true}
// 79 DKK plan only. Builds the court PDF SERVER-SIDE from database rows, signs it, registers its
// SHA-256 and e-mails it (default: the account e-mail). Nothing is returned for download.
// Logs never contain content or recipients.
import { authed, cors, json } from "../_shared/http.ts";
import { sendMail, type MailLang } from "../_shared/email.ts";
import { appUrl } from "../_shared/links.ts";
import { renderPdf, sha256Hex } from "../_shared/pdf/render.ts";
import { signPdf, signingKeyFromEnv } from "../_shared/pdf/sign.ts";
import { runConversationExport } from "../_shared/conversationExport.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const a = await authed(req); if (a instanceof Response) return a;
  let input: Record<string, unknown>; try { input = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const key = signingKeyFromEnv();
  const r = await runConversationExport(a.uid, input, {
    rpc: (n, args) => a.admin.rpc(n, args), render: renderPdf, sha256: sha256Hex, mail: sendMail, appUrl: appUrl(),
    sign: key ? (pdf, id) => signPdf(pdf, key, id) : null,
    lang: input.lang === "en" || input.lang === "da" ? input.lang as MailLang : undefined,
  });
  const outcome = r.status === 200 ? "sent" : String(r.body.error); // status/error code only, never content
  console.log(`export-conversation: ${outcome}`);
  return json(r.status === 200 ? { data: r.body } : r.body, r.status);
});

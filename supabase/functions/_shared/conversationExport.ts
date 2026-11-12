// Court export flow (export-conversation Edge Function). Dependencies are injected so the whole
// flow is unit-testable without network. The PDF is built ONLY from get_export_messages rows
// (server-side visibility rules); the request body never carries message content.
import { buildModel, groupCode, scopeInLang, validTimeZone, type ExportMessage } from "./pdf/layout.ts";
import { exportMail, exportNoticeMail, preferLang, storedLang, type MailAttachment, type MailLang } from "./email.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
export type ExportDeps = {
  rpc: Rpc;
  render: (model: ReturnType<typeof buildModel>) => { bytes: Uint8Array; pages: number };
  sign: ((pdf: Uint8Array, exportId: string) => Promise<Uint8Array>) | null;
  sha256: (b: Uint8Array) => Promise<string>;
  mail: (to: string, m: { subject: string; html: string; text: string; attachments?: MailAttachment[] }) => Promise<boolean>;
  appUrl: string;
  /** Exporter's app language (client or stored). Default da. */
  lang?: MailLang;
};
export type ExportRequest = { conversation_id?: unknown; recipient?: unknown; email?: unknown; from?: unknown; to?: unknown; time_zone?: unknown; confirm?: unknown };
type Result = { status: number; body: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** UTC instant of local wall-clock time `date` + `hms` in zone `tz` (DST-safe, two-pass). */
export function zonedInstant(date: string, hms: [number, number, number, number], tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number); const guess = Date.UTC(y, mo - 1, d, ...hms);
  const off = (t: number) => { const p: Record<string, number> = {}; for (const x of new Intl.DateTimeFormat("en", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = Number(x.value); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000; };
  let t = guess - off(guess); t = guess - off(t); return new Date(t);
}
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { error, ...extra } });
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

export async function runConversationExport(uid: string, input: ExportRequest, deps: ExportDeps): Promise<Result> {
  const conv = String(input.conversation_id ?? ""); const kind = input.recipient === "other" ? "other" : input.recipient === "self" ? "self" : null;
  if (!UUID.test(conv) || !kind) return err(400, "bad_input");
  if (input.confirm !== true) return err(400, "confirmation_required");
  const tz = validTimeZone(input.time_zone);
  const from = input.from == null || input.from === "" ? null : String(input.from), to = input.to == null || input.to === "" ? null : String(input.to);
  if ((from && !DAY.test(from)) || (to && !DAY.test(to)) || (from && to && from > to)) return err(400, "bad_period");
  const pFrom = from ? zonedInstant(from, [0, 0, 0, 0], tz).toISOString() : null;
  const pTo = to ? zonedInstant(to, [23, 59, 59, 999], tz).toISOString() : null;
  // Entitlement first (authoritative server-side plan; the SQL also enforces it).
  const plan = await deps.rpc("_effective_plan", { uid });
  if (plan.error) return err(503, "technical_error");
  if (plan.data !== "text_attachments") return err(402, "plan_required");
  if (!deps.sign) return err(503, "signing_unavailable");
  const begun = await deps.rpc("begin_conversation_export", { p_uid: uid, conv, p_from: pFrom, p_to: pTo, p_kind: kind, p_email: kind === "other" ? String(input.email ?? "") : null });
  if (begun.error) {
    const m = begun.error.message;
    for (const [re, st, code] of [[/plan_required/, 402, "plan_required"], [/not_member/, 403, "not_member"], [/bad_email/, 400, "bad_email"], [/bad_period/, 400, "bad_period"], [/rate_limited/, 429, "rate_limited"]] as const)
      if (re.test(m)) return err(st, code);
    return err(500, "export_failed");
  }
  const b = (begun.data as any[])?.[0]; if (!b) return err(500, "export_failed");
  const fail = async (status: number, code: string) => { await deps.rpc("finish_conversation_export", { p_id: b.export_id, p_uid: uid, p_ok: false, p_sha: null, p_count: null, p_pages: null }); return err(status, code); };
  const rows = await deps.rpc("get_export_messages", { p_uid: uid, conv, p_from: pFrom, p_to: pTo });
  if (rows.error) return fail(500, "export_failed");
  const verifyUrl = `${deps.appUrl}tjek.html?k=${b.verify_code}`;
  const model = buildModel((rows.data ?? []) as ExportMessage[], {
    exportId: b.export_id, verifyCode: b.verify_code, verifyUrl, exporterEmail: b.exporter_email, recipient: b.recipient,
    partners: b.partners ?? [], createdAt: b.created_at, timeZone: tz, periodFrom: pFrom, periodTo: pTo,
  });
  let signed: Uint8Array, pages: number;
  try { const r = deps.render(model); pages = r.pages; signed = await deps.sign(r.bytes, b.export_id); } catch { return fail(500, "export_failed"); }
  const sha = await deps.sha256(signed);
  const fin = await deps.rpc("finish_conversation_export", { p_id: b.export_id, p_uid: uid, p_ok: true, p_sha: sha, p_count: model.count, p_pages: pages });
  if (fin.error) return fail(500, "export_failed");
  const code = groupCode(b.verify_code);
  const exporterLang = preferLang(deps.lang, await storedLang(deps.rpc, { uid }));
  const recipLang = kind === "self" ? exporterLang : preferLang(await storedLang(deps.rpc, { email: b.recipient }));
  const recipScope = scopeInLang(model, recipLang);
  const mail = exportMail({ exporterEmail: b.exporter_email, toSelf: kind === "self", verifyUrl, code, exportId: b.export_id, scope: recipScope, count: model.count, pages, lang: recipLang });
  const day = new Date(b.created_at).toISOString().slice(0, 10);
  const fileStem = recipLang === "en" ? "rolff-transcript" : "rolff-udskrift";
  const ok = await deps.mail(b.recipient, { ...mail, attachments: [{ filename: `${fileStem}-${day}-${b.verify_code.slice(0, 4)}.pdf`, content_type: "application/pdf", content_b64: b64(signed) }] });
  if (!ok) { await deps.rpc("mark_conversation_export_failed", { p_id: b.export_id, p_uid: uid }); return err(502, "mail_failed"); }
  if (kind === "other") await deps.mail(b.exporter_email, exportNoticeMail({ recipient: b.recipient, exportId: b.export_id, scope: scopeInLang(model, exporterLang), count: model.count, lang: exporterLang }));
  return { status: 200, body: { status: "sent", recipient: b.recipient, export_id: b.export_id, verify_code: code, pages, message_count: model.count } };
}

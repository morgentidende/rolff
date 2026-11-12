// export-conversation flow with injected fakes: entitlement, confirmation, error mapping, DB-only
// content, sign-before-hash, mail failure, notice to the account email. No network, invented data.
import { runConversationExport, zonedInstant, type ExportDeps } from "../../supabase/functions/_shared/conversationExport.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c: unknown, m = "assertion failed") => { if (!c) throw new Error(m); };
const UID = "aaaaaaaa-0000-4000-8000-000000000001", CONV = "cccccccc-0000-4000-8000-000000000001", EID = "eeeeeeee-0000-4000-8000-000000000001";
const ROW = { id: "dddddddd-0000-4000-8000-000000000001", sender_label: "Mor (alias)", sender_email: "mor@x.test", sender_deleted: false, mine: false, body: "Fra databasen", created_at: "2026-11-06T08:00:00Z" };
function fake(o: { plan?: string; beginErr?: string; mailOk?: boolean; sign?: boolean; kind?: "self" | "other"; lang?: "da" | "en"; locales?: Record<string, string> } = {}) {
  const calls: { name: string; args: any }[] = []; const mails: { to: string; m: any }[] = []; let rendered: any = null; let hashed: Uint8Array | null = null;
  const deps: ExportDeps = {
    appUrl: "https://rolff.example/",
    lang: o.lang,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "_effective_plan") return { data: o.plan ?? "text_attachments", error: null };
      if (name === "begin_conversation_export") return o.beginErr ? { data: null, error: { message: o.beginErr } } : { data: [{ export_id: EID, verify_code: "0123456789ABCDEF0123", created_at: "2026-11-09T10:00:00Z", recipient: o.kind === "other" ? "advokat@x.test" : "a@x.test", exporter_email: "a@x.test", partners: ["Mor (alias)"], partial: false }], error: null };
      if (name === "get_export_messages") return { data: [ROW], error: null };
      if (name === "locale_for_email") return { data: o.locales?.[String(args.p_email)] ?? null, error: null };
      if (name === "locale_of") return { data: o.locales?.[String(args.p_uid)] ?? null, error: null };
      return { data: null, error: null };
    },
    render: (m) => { rendered = m; return { bytes: new TextEncoder().encode("%PDF-unsigned"), pages: 2 }; },
    sign: o.sign === false ? null : async (pdf) => new Uint8Array([...pdf, ...new TextEncoder().encode("+SIG")]),
    sha256: async (b) => { hashed = b; return "f".repeat(64); },
    mail: async (to, m) => { mails.push({ to, m }); return o.mailOk ?? true; },
  };
  return { deps, calls, mails, get rendered() { return rendered; }, get hashed() { return hashed; } };
}
const req = (x: Record<string, unknown> = {}) => ({ conversation_id: CONV, recipient: "self", confirm: true, time_zone: "Europe/Copenhagen", ...x });

Deno.test("49-plan: 402 plan_required før der oprettes en eksport", async () => {
  const f = fake({ plan: "text" }); const r = await runConversationExport(UID, req(), f.deps);
  eq([r.status, r.body.error], [402, "plan_required"]); eq(f.calls.map((c) => c.name), ["_effective_plan"]); eq(f.mails.length, 0);
});
Deno.test("Bekræftelse, input og periode valideres; uden signeringsnøgle fejler den lukket", async () => {
  eq((await runConversationExport(UID, req({ confirm: undefined }), fake().deps)).body.error, "confirmation_required");
  eq((await runConversationExport(UID, req({ conversation_id: "x" }), fake().deps)).body.error, "bad_input");
  eq((await runConversationExport(UID, req({ recipient: "phone" }), fake().deps)).body.error, "bad_input");
  eq((await runConversationExport(UID, req({ from: "2026-11-09", to: "2026-11-01" }), fake().deps)).body.error, "bad_period");
  const f = fake({ sign: false }); const r = await runConversationExport(UID, req(), f.deps);
  eq([r.status, r.body.error], [503, "signing_unavailable"]); ok(!f.calls.some((c) => c.name === "begin_conversation_export"));
});
Deno.test("Fejl fra databasen mappes (rate limit 429, e-mail, medlemskab)", async () => {
  for (const [m, st, code] of [["rate_limited", 429, "rate_limited"], ["bad_email", 400, "bad_email"], ["not_member", 403, "not_member"], ["plan_required", 402, "plan_required"], ["boom", 500, "export_failed"]] as const) {
    const r = await runConversationExport(UID, req(), fake({ beginErr: m }).deps); eq([r.status, r.body.error], [st, code]);
  }
});
Deno.test("Indhold kommer kun fra databasen; klientfelter ignoreres; signering før hash; PDF kun pr. mail", async () => {
  const f = fake(); const r = await runConversationExport(UID, req({ messages: [{ body: "FORFALSKET" }], body: "FORFALSKET", from: "2026-11-01", to: "2026-11-07" }), f.deps);
  eq(r.status, 200); eq(r.body.status, "sent"); eq(r.body.recipient, "a@x.test"); eq(r.body.verify_code, "0123-4567-89AB-CDEF-0123");
  ok(!JSON.stringify(r.body).includes("PDF") && !("pdf" in r.body) && !("content_b64" in r.body), "response must not carry the PDF");
  eq(f.rendered.days.flatMap((d: any) => d.items.map((i: any) => i.m.body)), ["Fra databasen"]);
  eq(new TextDecoder().decode(f.hashed!), "%PDF-unsigned+SIG");
  const begin = f.calls.find((c) => c.name === "begin_conversation_export")!.args;
  eq([begin.p_from, begin.p_to, begin.p_email], ["2026-10-31T23:00:00.000Z", "2026-11-07T22:59:59.999Z", null]);
  const fin = f.calls.find((c) => c.name === "finish_conversation_export")!.args; eq([fin.p_ok, fin.p_sha, fin.p_count, fin.p_pages], [true, "f".repeat(64), 1, 2]);
  ok(f.calls.findIndex((c) => c.name === "finish_conversation_export") >= 0);
  eq(f.mails.length, 1); const a = f.mails[0].m.attachments[0];
  eq([a.filename, a.content_type, atob(a.content_b64)], ["rolff-udskrift-2026-11-09-0123.pdf", "application/pdf", "%PDF-unsigned+SIG"]);
  ok(f.mails[0].m.text.includes("https://rolff.example/tjek.html?k=0123456789ABCDEF0123")); ok(f.mails[0].m.text.includes("0123-4567-89AB-CDEF-0123"));
});
Deno.test("Anden modtager: udskrift til modtager + besked til kontoens e-mail", async () => {
  const f = fake({ kind: "other" }); const r = await runConversationExport(UID, req({ recipient: "other", email: "advokat@x.test" }), f.deps);
  eq(r.status, 200); eq(f.calls.find((c) => c.name === "begin_conversation_export")!.args.p_email, "advokat@x.test");
  eq(f.mails.map((m) => m.to), ["advokat@x.test", "a@x.test"]); ok(!f.mails[1].m.attachments); ok(f.mails[1].m.text.includes("advokat@x.test"));
});
Deno.test("Udskrift til adresse uden konto følger anmoderens sprog; kendt dansk modtager forbliver dansk", async () => {
  const en = fake({ kind: "other", lang: "en" });
  const r = await runConversationExport(UID, req({ recipient: "other", email: "advokat@x.test" }), en.deps);
  eq(r.status, 200);
  eq(en.mails[0].m.subject, "a@x.test has sent you a transcript of a conversation from Rolff");
  eq(en.mails[0].m.attachments[0].filename, "rolff-transcript-2026-11-09-0123.pdf");
  ok(en.mails[1].m.subject.includes("You have sent a transcript"), en.mails[1].m.subject);
  const daRecip = fake({ kind: "other", lang: "en", locales: { "advokat@x.test": "da" } });
  const r2 = await runConversationExport(UID, req({ recipient: "other", email: "advokat@x.test" }), daRecip.deps);
  eq(r2.status, 200);
  ok(daRecip.mails[0].m.subject.includes("har sendt dig en udskrift"), daRecip.mails[0].m.subject);
  eq(daRecip.mails[0].m.attachments[0].filename, "rolff-udskrift-2026-11-09-0123.pdf");
  ok(daRecip.mails[1].m.subject.includes("You have sent a transcript"), daRecip.mails[1].m.subject);
});
Deno.test("Mailfejl: eksporten markeres fejlet (kan ikke verificeres) og 502", async () => {
  const f = fake({ mailOk: false }); const r = await runConversationExport(UID, req(), f.deps);
  eq([r.status, r.body.error], [502, "mail_failed"]); ok(f.calls.some((c) => c.name === "mark_conversation_export_failed" && c.args.p_id === EID));
});
Deno.test("zonedInstant: lokal midnat er korrekt omkring sommertid", () => {
  eq(zonedInstant("2026-03-29", [0, 0, 0, 0], "Europe/Copenhagen").toISOString(), "2026-03-28T23:00:00.000Z");
  eq(zonedInstant("2026-03-29", [23, 59, 59, 999], "Europe/Copenhagen").toISOString(), "2026-03-29T21:59:59.999Z");
  eq(zonedInstant("2026-11-01", [0, 0, 0, 0], "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
});

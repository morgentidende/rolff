// Pure validation for the report endpoint (unit-tested): body ≤ 2000 characters, ≤ 20 message ids.
export const REPORT_CATS = ["harassment", "inappropriate", "child_safety", "other"];
export const REPORT_BODY_MAX = 2000, REPORT_MSGS_MAX = 20;
const UUID = /^[0-9a-f-]{36}$/i;
export type ReportInput = { conv: string; category: string; body: string; ids: string[] };
export function parseReport(i: unknown): ReportInput | null {
  const o = (i ?? {}) as Record<string, unknown>;
  const conv = String(o.conversation_id ?? "");
  const category = REPORT_CATS.includes(o.category as string) ? o.category as string : null;
  const body = String(o.body ?? "").trim();
  const ids = Array.isArray(o.message_ids) ? o.message_ids.map(String) : [];
  if (!UUID.test(conv) || !category || [...body].length > REPORT_BODY_MAX || ids.length > REPORT_MSGS_MAX || !ids.every((x) => UUID.test(x))) return null;
  if (!body && ids.length === 0) return null;
  return { conv, category, body, ids };
}

// Daily: warn users with a shorter retention 3 days before their first messages would disappear.
// The database decides who (claim_retention_warnings: once per batch, 30-day cooldown) and queues the push; this sends the mail.
// No message text anywhere. A mail that cannot be sent releases the claim so tomorrow's run retries.
import { appUrl } from "./links.ts";
import { mailLang, retentionWarningMail, type MailKind, type MailMsg } from "./email.ts";

export type WarnRow = { user_id: string; email: string | null; lang: string | null; retention: string };
export type WarnDeps = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  send: (to: string, m: MailMsg, kind: MailKind) => Promise<boolean>;
  /** In test environments only addresses matching the allow-list get mail. */
  allowed: (email: string) => boolean;
  link?: string;
};
export const retentionLink = (base = appUrl()) => `${base}#privacy`;

export async function runRetentionWarnings(d: WarnDeps): Promise<{ claimed: number; mailed: number; skipped: number; released: number }> {
  const r = await d.rpc("claim_retention_warnings");
  if (r.error || !Array.isArray(r.data)) return { claimed: 0, mailed: 0, skipped: 0, released: 0 };
  let mailed = 0, skipped = 0, released = 0;
  for (const row of r.data as WarnRow[]) {
    const to = (row.email ?? "").trim();
    if (!to || !d.allowed(to)) { skipped++; continue; } // push (if any) still goes out; no address / not allowed here -> no mail
    const m = retentionWarningMail({ link: d.link ?? retentionLink(), retention: row.retention, lang: mailLang(row.lang) });
    let ok = false;
    try { ok = await d.send(to, m, "retention"); } catch { ok = false; }
    if (ok) mailed++;
    else { released++; await d.rpc("release_retention_warning", { p_uid: row.user_id }); }
  }
  return { claimed: r.data.length, mailed, skipped, released };
}

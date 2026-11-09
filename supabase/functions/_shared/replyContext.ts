import { withReplyContext, type ContextMsg } from "./moderation.ts";
/** Server-side only: the replied-to message for moderation context, fetched AFTER assert_reply_target.
 *  reply_moderation_context re-applies the same visibility rules (never returns a message the sender
 *  cannot see) and returns only who wrote it + the first 300 characters + its position. */
export async function replyModerationContext(admin: any, uid: string, conv: string, reply: string | null, ctx: ContextMsg[]): Promise<ContextMsg[] | "invalid_reply" | "error"> {
  if (reply === null) return withReplyContext(ctx, null);
  const r = await admin.rpc("reply_moderation_context", { p_sender: uid, conv, p_reply: reply });
  if (r.error) return /invalid_reply/.test(r.error.message ?? "") ? "invalid_reply" : "error";
  const row = (r.data ?? [])[0];
  if (!row || typeof row.mine !== "boolean" || typeof row.body !== "string" || !Number.isInteger(row.newer)) return "error";
  return withReplyContext(ctx, { mine: row.mine, body: row.body, newer: row.newer });
}

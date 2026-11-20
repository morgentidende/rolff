export type OtherLabel = { user_id: string; email: string; alias: string | null };
export type ConvLabels = { others?: OtherLabel[] | null; pending_invitee?: string | null; pending_alias?: string | null };
/** A conversation nobody has accepted yet (only the owner is in it). It has no chat to open: the front page offers a
 * two-choice menu instead (change nickname / cancel invitation) and every route into the chat must refuse it. */
export const isPendingOnly = (c: { others?: unknown[] | null; pending_invitation_id?: string | null; pending_invitee?: string | null } | null | undefined) =>
  !!c && !c.others?.length && !!(c.pending_invitation_id || c.pending_invitee);
export const labelOf = (o: OtherLabel) => o.alias || o.email;
/** Title + optional status for a conversation row/header. Pending invites show the invitee, not a generic "Venter…". */
export function convDisplay(c: ConvLabels, da: boolean) {
  if (c.others?.length) {
    const title = c.others.map(labelOf).join(", ");
    return { title, status: null as string | null, initial: (title.trim().match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase() };
  }
  const email = (c.pending_invitee || "").trim() || null;
  // The owner's private nickname for someone who has not accepted yet wins over the e-mail.
  const alias = (c.pending_alias || "").trim() || null;
  const title = alias || email || (da ? "Venter på den anden part" : "Waiting for the other party");
  const status = da ? "venter på accept" : "awaiting acceptance";
  const initial = (alias || email) ? ((alias || email)!.match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase() : "?";
  return { title, status, initial };
}

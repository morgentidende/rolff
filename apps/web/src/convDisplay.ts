export type OtherLabel = { user_id: string; email: string; alias: string | null };
export type ConvLabels = { others?: OtherLabel[] | null; pending_invitee?: string | null };
export const labelOf = (o: OtherLabel) => o.alias || o.email;
/** Title + optional status for a conversation row/header. Pending invites show the invitee, not a generic "Venter…". */
export function convDisplay(c: ConvLabels, da: boolean) {
  if (c.others?.length) {
    const title = c.others.map(labelOf).join(", ");
    return { title, status: null as string | null, initial: (title.trim().match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase() };
  }
  const email = (c.pending_invitee || "").trim() || null;
  const title = email || (da ? "Venter på den anden part" : "Waiting for the other party");
  const status = da ? "venter på accept" : "awaiting acceptance";
  const initial = email ? (email.match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase() : "?";
  return { title, status, initial };
}

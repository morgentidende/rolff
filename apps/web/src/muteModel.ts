// Per-conversation mute ("Lydløs"). Pure helpers: durations, state and wording.
// The mute is stored server-side per user and conversation; only the owner can read it.
export type MuteDuration = "8h" | "24h" | "1w" | "always";
export type MuteRow = { conversation_id: string; mute_until: string | null; always?: boolean };
/** Durations offered in the mute dialog. "24h" remains accepted by the server for existing rows. */
export const MUTE_DURATIONS: { id: Exclude<MuteDuration, "24h">; da: string; en: string }[] = [
  { id: "8h", da: "8 timer", en: "8 hours" },
  { id: "1w", da: "1 uge", en: "1 week" },
  { id: "always", da: "Altid", en: "Always" },
];
/** The caller's active mute for one conversation, or null (expired rows never count). */
export function activeMute(rows: readonly MuteRow[] | null | undefined, conv: string, now = Date.now()): MuteRow | null {
  const r = rows?.find((x) => x.conversation_id === conv);
  if (!r) return null;
  if (r.always || r.mute_until == null) return { ...r, mute_until: null, always: true };
  const t = Date.parse(r.mute_until);
  if (!Number.isFinite(t)) return null;
  return t > now ? r : null;
}
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** "14.30" today, "i morgen 14.30", "lør. 14.30" within the week, otherwise "26. nov. 14.30". */
export function muteUntilText(iso: string, da: boolean, now = Date.now()): string {
  const t = new Date(iso), loc = da ? "da-DK" : "en-GB";
  const time = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  const days = Math.round((dayStart(t) - dayStart(new Date(now))) / 86400000);
  if (days <= 0) return time;
  if (days === 1) return `${da ? "i morgen" : "tomorrow"} ${time}`;
  if (days < 7) return `${new Intl.DateTimeFormat(loc, { weekday: "short" }).format(t)} ${time}`;
  return `${new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).format(t)} ${time}`;
}
/** Menu wording: mute opens the duration dialog; unmute takes effect immediately. */
export function muteMenuLabel(m: MuteRow | null, da: boolean): string {
  return m ? unmuteLabel(da) : (da ? "Slå notifikationer fra" : "Mute notifications");
}
export const unmuteLabel = (da: boolean) => (da ? "Slå notifikationer til" : "Unmute notifications");

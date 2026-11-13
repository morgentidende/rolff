// Day separators in the chat ("I dag", "I går", weekday, or date), in the device's local time.
export const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export function dayLabel(iso: string, lang: string, now = new Date()): string {
  const da = lang === "da";
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 864e5);
  if (diff === 0) return da ? "I dag" : "Today";
  if (diff === 1) return da ? "I går" : "Yesterday";
  const loc = da ? "da-DK" : "en-GB";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (diff > 1 && diff < 7) return cap(d.toLocaleDateString(loc, { weekday: "long" }));
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear() ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" };
  return cap(d.toLocaleDateString(loc, opts));
}
/** Group messages so each day's sticky pill is constrained to its own section (the next day pushes the previous pill away). */
export function groupMessagesByDay<T extends { created_at: string }>(msgs: T[]): { key: string; start: number; msgs: T[] }[] {
  const groups: { key: string; start: number; msgs: T[] }[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const key = dayKey(msgs[i].created_at);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, start: i, msgs: [msgs[i]] });
    else groups[groups.length - 1].msgs.push(msgs[i]);
  }
  return groups;
}

import { activeMute, muteMenuLabel, muteUntilText, MUTE_DURATIONS, unmuteLabel } from "../../apps/web/src/muteModel.ts";
function eq(a: unknown, b: unknown) { if (a !== b) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
const CONV = "20000000-0000-4000-8000-000000000001";
// All dates are built in local time, so the tests do not depend on the runner's time zone.
const now = new Date(2026, 10, 19, 10, 0).getTime();
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m).toISOString();
Deno.test("durations offered in the dialog are exactly 8 timer, 1 uge, Altid (da) and 8 hours, 1 week, Always (en)", () => {
  eq(MUTE_DURATIONS.map((d) => d.id).join(), "8h,1w,always");
  eq(MUTE_DURATIONS.map((d) => d.da).join("|"), "8 timer|1 uge|Altid");
  eq(MUTE_DURATIONS.map((d) => d.en).join("|"), "8 hours|1 week|Always");
});
Deno.test("activeMute: future, always (null or flag) and expired", () => {
  eq(activeMute([{ conversation_id: CONV, mute_until: at(19, 14, 30) }], CONV, now)?.mute_until, at(19, 14, 30));
  eq(activeMute([{ conversation_id: CONV, mute_until: null }], CONV, now)?.always, true);
  eq(activeMute([{ conversation_id: CONV, mute_until: null, always: true }], CONV, now)?.always, true);
  eq(activeMute([{ conversation_id: CONV, mute_until: at(19, 9, 59) }], CONV, now), null);
  eq(activeMute([{ conversation_id: "other", mute_until: null }], CONV, now), null);
  eq(activeMute([], CONV, now), null); eq(activeMute(null, CONV, now), null);
  eq(activeMute([{ conversation_id: CONV, mute_until: "not a date" }], CONV, now), null);
});
Deno.test("muteUntilText: today, tomorrow, weekday, later date (da and en)", () => {
  eq(muteUntilText(at(19, 14, 30), true, now), "14.30");
  eq(muteUntilText(at(19, 14, 30), false, now), "14:30");
  eq(muteUntilText(at(20, 9, 5), true, now), "i morgen 09.05");
  eq(muteUntilText(at(20, 9, 5), false, now), "tomorrow 09:05");
  if (!/^\S+ 08\.00$/.test(muteUntilText(at(23, 8, 0), true, now))) throw new Error("weekday form");
  if (!/^\d+\. \S+ 08\.00$/.test(muteUntilText(at(26, 8, 0), true, now))) throw new Error("date form");
});
Deno.test("menu wording: Slå notifikationer fra / til (da) and Mute / Unmute notifications (en)", () => {
  eq(muteMenuLabel(null, true), "Slå notifikationer fra"); eq(muteMenuLabel(null, false), "Mute notifications");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: at(19, 14, 30) }, true), "Slå notifikationer til");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: at(19, 14, 30) }, false), "Unmute notifications");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: null, always: true }, true), "Slå notifikationer til");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: null, always: true }, false), "Unmute notifications");
  eq(unmuteLabel(true), "Slå notifikationer til"); eq(unmuteLabel(false), "Unmute notifications");
});
Deno.test("mute is wired server-side only, owner-only, and never into delivery or receive times", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261119210000_conversation_mutes.sql");
  for (const need of ["enable row level security", "user_id = auth.uid()", "conversation_is_muted", "notification_job_all_muted", "mute_until is null or"]) if (!sql.includes(need)) throw new Error("migration lacks " + need);
  if (/message_deliveries d set released_at\s*=\s*null/.test(sql)) throw new Error("mute must not touch delivery");
  const app = await Deno.readTextFile("apps/web/src/App.tsx");
  for (const need of ["set_my_conversation_mute", "clear_my_conversation_mute", "my_conversation_mutes", "convmuted", "MutedBellIcon"]) if (!app.includes(need)) throw new Error("app lacks " + need);
  const push = await Deno.readTextFile("apps/web/src/PushSettings.tsx");
  for (const need of ['da?"Notifikationer":"Notifications"', "Du får besked, når der kommer nye beskeder.", "You get notified when new messages arrive.", "Åbn Indstillinger, og tillad notifikationer til Rolff.", "Open Settings and allow notifications for Rolff."]) if (!push.includes(need)) throw new Error("push settings lacks " + need);
  for (const gone of ["Forny tilmelding nu", "Renew registration now", "fornyes senest", "renews by", "Tilmeldinger udløber efter 90 dage", "Registrations expire after 90 days", "Notifikationer på denne telefon", "Notifications on this phone", "details.more", "omtaler mine forældre"]) if (push.includes(gone)) throw new Error("push settings still has " + gone);
  for (const need of ["Tilmeldingen fornyes automatisk, mens du bruger appen", "The registration is renewed automatically while you use the app", "Du kan gøre en enkelt samtale lydløs i samtalens menu", "You can mute a single conversation in its menu"]) if (!app.includes(need)) throw new Error("FAQ lacks " + need);
  const dialog = await Deno.readTextFile("apps/web/src/MuteDialog.tsx");
  for (const model of ["ChatGPT", "GPT", "Gemini", "OpenAI"]) if (dialog.includes(model)) throw new Error("model name in mute UI");
  if (/{da \? "Annuller" : "Cancel"}/.test(dialog) || />Annuller</.test(dialog) || />Cancel</.test(dialog)) throw new Error("mute dialog must close with X, not Annuller");
  if (!dialog.includes('aria-label={da ? "Luk" : "Close"}')) throw new Error("mute dialog lacks X close");
});

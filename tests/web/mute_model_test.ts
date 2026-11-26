import { activeMute, muteMenuLabel, muteUntilText, MUTE_DURATIONS, unmuteLabel } from "../../apps/web/src/muteModel.ts";
function eq(a: unknown, b: unknown) { if (a !== b) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
const CONV = "20000000-0000-4000-8000-000000000001";
// All dates are built in local time, so the tests do not depend on the runner's time zone.
const now = new Date(2026, 10, 19, 10, 0).getTime();
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m).toISOString();
Deno.test("durations are exactly 8 timer, 24 timer, 1 uge, Altid (da) and 8 hours, 24 hours, 1 week, Always (en)", () => {
  eq(MUTE_DURATIONS.map((d) => d.id).join(), "8h,24h,1w,always");
  eq(MUTE_DURATIONS.map((d) => d.da).join("|"), "8 timer|24 timer|1 uge|Altid");
  eq(MUTE_DURATIONS.map((d) => d.en).join("|"), "8 hours|24 hours|1 week|Always");
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
Deno.test("menu wording: Lydløs / Lydløs til 14.30 / Lydløs altid and the English forms", () => {
  eq(muteMenuLabel(null, true), "Lydløs"); eq(muteMenuLabel(null, false), "Mute");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: at(19, 14, 30) }, true, now), "Lydløs til 14.30");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: at(19, 14, 30) }, false, now), "Muted until 14:30");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: null, always: true }, true), "Lydløs altid");
  eq(muteMenuLabel({ conversation_id: CONV, mute_until: null, always: true }, false), "Muted always");
  eq(unmuteLabel(true), "Slå lyd til"); eq(unmuteLabel(false), "Unmute");
});
Deno.test("mute is wired server-side only, owner-only, and never into delivery or receive times", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261119210000_conversation_mutes.sql");
  for (const need of ["enable row level security", "user_id = auth.uid()", "conversation_is_muted", "notification_job_all_muted", "mute_until is null or"]) if (!sql.includes(need)) throw new Error("migration lacks " + need);
  if (/message_deliveries d set released_at\s*=\s*null/.test(sql)) throw new Error("mute must not touch delivery");
  const app = await Deno.readTextFile("apps/web/src/App.tsx");
  for (const need of ["set_my_conversation_mute", "clear_my_conversation_mute", "my_conversation_mutes", "convmuted"]) if (!app.includes(need)) throw new Error("app lacks " + need);
  const push = await Deno.readTextFile("apps/web/src/PushSettings.tsx");
  for (const need of ["Notifikationer på denne telefon", "Notifications on this phone", "Du kan gøre en enkelt samtale lydløs i samtalens menu", "You can mute a single conversation in its menu", "Mere", "More", "Tilmeldingen fornyes automatisk, mens du bruger appen", "Registration is renewed automatically while you use the app", "Enheder, der ikke har været brugt i 90 dage, fjernes", "Devices unused for 90 days are removed"]) if (!push.includes(need)) throw new Error("push settings lacks " + need);
  for (const gone of ["Forny tilmelding nu", "Renew registration now", "fornyes senest", "renews by", "Tilmeldinger udløber efter 90 dage", "Registrations expire after 90 days"]) if (push.includes(gone)) throw new Error("push settings still has " + gone);
  for (const model of ["ChatGPT", "GPT", "Gemini", "OpenAI"]) if ((await Deno.readTextFile("apps/web/src/MuteDialog.tsx")).includes(model)) throw new Error("model name in mute UI");
});

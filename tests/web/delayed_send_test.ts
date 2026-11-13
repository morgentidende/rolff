const assert = (value: boolean, label: string) => { if (!value) throw new Error(label); };

Deno.test("Delayed send helpers: countdown and soonest pending", async () => {
  const { countdownAria, isPendingSend, pendingSeconds, soonestPending, DELAYED_SEND_SECONDS } = await import("../../apps/web/src/delayedSend.ts");
  assert(DELAYED_SEND_SECONDS === 30, "delay is 30 seconds");
  const now = Date.parse("2026-11-13T08:00:00.000Z");
  const until = "2026-11-13T08:00:27.000Z";
  assert(isPendingSend(until, now) === true, "future deliver_after is pending");
  assert(pendingSeconds(until, now) === 27, "27 seconds left");
  assert(countdownAria("da", 27) === "Send nu (27 s)", "da aria");
  assert(countdownAria("en", 27) === "Send now (27 s)", "en aria");
  assert(isPendingSend("2026-11-13T07:59:59.000Z", now) === false, "past is not pending");
  assert(pendingSeconds(null, now) === null, "missing is not pending");
  const msgs = [
    { id: "a", deliver_after: "2026-11-13T08:00:27.000Z" },
    { id: "b", deliver_after: "2026-11-13T08:00:10.000Z" },
    { id: "c", deliver_after: null },
  ];
  assert(soonestPending(msgs, now)?.id === "b", "soonest pending wins");
});

Deno.test("Send button keeps the arrow, shows the countdown, and a draining ring; tap sends now", async () => {
  const ui = await Deno.readTextFile("apps/web/src/ComposerInput.tsx");
  const css = await Deno.readTextFile("apps/web/src/styles.css");
  assert(ui.includes("is-countdown"), "countdown class");
  assert(ui.includes("Send nu (${countSec} s)") && ui.includes("Send now (${countSec} s)"), "aria labels");
  assert(ui.includes("send-now-ring") && ui.includes("strokeDashoffset"), "progress ring");
  assert(ui.includes("send-now-count") && ui.includes("send-now-stack"), "number sits with the arrow");
  assert(ui.includes("onSendNow") && ui.includes("counting ? onSendNow : onSend"), "tap sends now");
  assert(css.includes("send-now-ring") && css.includes("send-now-pulse"), "ring and pulse styles");
  assert(css.includes("prefers-reduced-motion"), "pulse respects reduced motion");
});

Deno.test("Chat menu has a delayed-messages checkmark toggle; pending bubbles can be edited or deleted", async () => {
  const app = await Deno.readTextFile("apps/web/src/App.tsx");
  const bubble = await Deno.readTextFile("apps/web/src/MessageBubble.tsx");
  assert(app.includes('"Forsinkede beskeder"') && app.includes('"Delayed messages"'), "menu labels");
  assert(app.includes("get_messages_v3"), "client uses v3");
  assert(app.includes("checked: delayedOn") && app.includes("menuitemcheckbox"), "checkmark toggle");
  assert(app.includes("release_delayed_message") && app.includes("cancel_delayed_message") && app.includes("set_delayed_send"), "server RPCs");
  assert(app.includes("edit_message_id") && app.includes("beginEdit"), "edit goes through send-message");
  assert(bubble.includes('da ? "Ret" : "Edit"') && bubble.includes('da ? "Slet" : "Delete"'), "edit/delete on pending bubble");
  assert(bubble.includes("pending-send"), "pending style hook");
});

Deno.test("Edits of delayed messages are re-moderated in send-message; delivery never bypasses the hold", async () => {
  const fn = await Deno.readTextFile("supabase/functions/send-message/index.ts");
  const mig = await Deno.readTextFile("supabase/migrations/20261113100000_delayed_messages.sql");
  assert(fn.includes("edit_message_id") && fn.includes("update_delayed_message"), "edit path");
  assert(fn.includes("applySticky") && fn.includes("doubleCheckFromEnv"), "sticky and double check still run");
  assert(mig.includes("deliver_after") && mig.includes("_release_for"), "server hold");
  assert(mig.includes("create function public.get_messages_v3"), "v3 passes deliver_after");
  assert(mig.includes("m.deliver_after is null or m.deliver_after <= clock_timestamp()"), "release waits for due time");
  assert(mig.includes("release_delayed_message") && mig.includes("cancel_delayed_message"), "send-now and delete");
});

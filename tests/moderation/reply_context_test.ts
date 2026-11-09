// Reply (Besvar) context for Luna. Synthetic text only; every provider call is a mocked fetch.
import { assertEquals } from "jsr:@std/assert@1";
import { buildUserPayload, contextFields, OpenAIProvider, GeminiProvider, SYSTEM_PROMPT, withReplyContext, type ContextMsg } from "../../supabase/functions/_shared/moderation.ts";
import { buildFilePayload } from "../../supabase/functions/_shared/attachments.ts";
import { checkTopics, TOPIC_PROMPT } from "../../supabase/functions/_shared/topics.ts";
import { replyModerationContext } from "../../supabase/functions/_shared/replyContext.ts";

const ctx10: ContextMsg[] = Array.from({ length: 10 }, (_, i) => ({ mine: i % 2 === 0, body: `Syntetisk ${i}` }));
const allow = JSON.stringify({ decision: "allow", reason_code: "none", spans: [], suggestion: "" });

Deno.test("no reply: same last-5 context as before, no reply fields", () => {
  const p = JSON.parse(buildUserPayload("Ny", withReplyContext(ctx10, null)));
  assertEquals(p.context.map((c: any) => c.text), ["Syntetisk 5", "Syntetisk 6", "Syntetisk 7", "Syntetisk 8", "Syntetisk 9"]);
  assertEquals("replying_to" in p, false);
  assertEquals(p.context.some((c: any) => "replied_to" in c), false);
  assertEquals(Object.keys(p).sort(), ["context", "new_message"]);
});

Deno.test("old reply target outside the last 5 is sent once as replying_to (cut to 300, who wrote it)", () => {
  const target = { mine: false, body: "Gammel aftale " + "y".repeat(400), newer: 12 };
  const p = JSON.parse(buildUserPayload("Ja, det passer stadig.", withReplyContext(ctx10, target)));
  assertEquals(p.context.length, 5);
  assertEquals(p.replying_to.from, "other");
  assertEquals([...p.replying_to.text].length, 300);
  assertEquals(Object.keys(p.replying_to).sort(), ["from", "text"]);
  assertEquals(p.context.some((c: any) => "replied_to" in c), false);
  assertEquals(p.new_message, "Ja, det passer stadig.");
});

Deno.test("reply target already among the last 5 is marked in place, not duplicated", () => {
  const p = JSON.parse(buildUserPayload("Svar", withReplyContext(ctx10, { mine: true, body: "Syntetisk 6", newer: 3 })));
  assertEquals(p.context.length, 5);
  assertEquals("replying_to" in p, false);
  assertEquals(p.context.filter((c: any) => c.replied_to).map((c: any) => [c.from, c.text]), [["sender", "Syntetisk 6"]]);
});

Deno.test("position race (row does not match) or newer>=5 falls back to separate replying_to", () => {
  for (const t of [{ mine: true, body: "Anden tekst", newer: 3 }, { mine: false, body: "Syntetisk 6", newer: 3 }, { mine: true, body: "Syntetisk 4", newer: 5 }, { mine: true, body: "x", newer: -1 }]) {
    const p = JSON.parse(buildUserPayload("Svar", withReplyContext(ctx10, t)));
    assertEquals(p.context.length, 5); assertEquals(typeof p.replying_to?.text, "string");
    assertEquals(p.context.some((c: any) => c.replied_to), false);
  }
});

Deno.test("short conversation: target newest of few messages marked in place", () => {
  const p = contextFields(withReplyContext([{ mine: false, body: "Hej" }, { mine: true, body: "Hej igen" }], { mine: false, body: "Hej", newer: 1 }));
  assertEquals(p.context, [{ from: "other", text: "Hej", replied_to: true }, { from: "sender", text: "Hej igen" }]);
});

Deno.test("file payload carries the same reply context", () => {
  const p = JSON.parse(buildFilePayload("Billede", "a.png", withReplyContext(ctx10, { mine: false, body: "Send skemaet", newer: 9 })));
  assertEquals(p.replying_to, { from: "other", text: "Send skemaet" });
  assertEquals(p.context.length, 5);
});

Deno.test("prompts: reply context is untrusted, context-only and never judged", () => {
  for (const s of ["replying_to", "replied_to", "never judge, block or quote it", "UNTRUSTED DATA"]) if (!SYSTEM_PROMPT.includes(s)) throw new Error("system prompt missing " + s);
  if (!TOPIC_PROMPT.includes("replying_to") || !TOPIC_PROMPT.includes("evidence for referents only")) throw new Error("topic prompt");
});

Deno.test("OpenAI and Gemini providers send replying_to (mocked fetch, no network)", async () => {
  const orig = globalThis.fetch; const seen: any[] = [];
  globalThis.fetch = (async (url: string, init: any) => { const b = JSON.parse(init.body); seen.push({ url, b });
    return String(url).includes("openai") ? new Response(JSON.stringify({ choices: [{ message: { content: allow } }] }), { status: 200 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: allow }] } }] }), { status: 200 }); }) as any;
  try {
    const c = withReplyContext(ctx10, { mine: false, body: "Kan du hente fredag?", newer: 20 });
    await new OpenAIProvider("sk-test", "m").moderate("Ja.", c, new AbortController().signal);
    await new GeminiProvider("g-test", "m").moderate("Ja.", c, new AbortController().signal);
  } finally { globalThis.fetch = orig; }
  assertEquals(JSON.parse(seen[0].b.messages[1].content).replying_to, { from: "other", text: "Kan du hente fredag?" });
  assertEquals(JSON.parse(seen[1].b.contents[0].parts[0].text).replying_to, { from: "other", text: "Kan du hente fredag?" });
});

Deno.test("topic boundary check also receives replying_to (mocked fetch)", async () => {
  const orig = globalThis.fetch; let payload: any = null;
  globalThis.fetch = (async (_u: string, init: any) => { payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "allow" }) } }] }), { status: 200 }); }) as any;
  try {
    const env = { get: (k: string) => ({ MODERATION_PROVIDER: "openai", MODERATION_TIER: "paid", OPENAI_API_KEY: "sk-test" } as Record<string, string>)[k] };
    assertEquals(await checkTopics(env, "Ja", ["syntetisk emne"], withReplyContext(ctx10, { mine: true, body: "Gammel", newer: 8 }), 3000), "allow");
  } finally { globalThis.fetch = orig; }
  assertEquals(payload.replying_to, { from: "sender", text: "Gammel" });
  assertEquals(JSON.parse(payload.new_message).new_message, "Ja");
});

const fakeAdmin = (res: any) => { const calls: any[] = []; return { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return res; } }; };
Deno.test("server fetch: no reply -> no RPC; ok -> merged; invalid/error/bad shape fail closed", async () => {
  let a = fakeAdmin({ data: [], error: null });
  assertEquals((await replyModerationContext(a, "u", "c", null, ctx10) as ContextMsg[]).length, 5); assertEquals(a.calls.length, 0);
  a = fakeAdmin({ data: [{ mine: false, body: "Gammel", newer: 9 }], error: null });
  const r = await replyModerationContext(a, "u", "c", "r", ctx10) as ContextMsg[];
  assertEquals(a.calls, [{ name: "reply_moderation_context", args: { p_sender: "u", conv: "c", p_reply: "r" } }]);
  assertEquals(r.at(-1), { mine: false, body: "Gammel", reply: "outside" });
  assertEquals(await replyModerationContext(fakeAdmin({ data: null, error: { message: "invalid_reply" } }), "u", "c", "r", ctx10), "invalid_reply");
  assertEquals(await replyModerationContext(fakeAdmin({ data: null, error: { message: "boom" } }), "u", "c", "r", ctx10), "error");
  assertEquals(await replyModerationContext(fakeAdmin({ data: [], error: null }), "u", "c", "r", ctx10), "error");
  assertEquals(await replyModerationContext(fakeAdmin({ data: [{ mine: "x", body: 1, newer: 0 }], error: null }), "u", "c", "r", ctx10), "error");
});

import { assertEquals } from "jsr:@std/assert@1";
import { parseReport } from "../../supabase/functions/_shared/reportInput.ts";
const conv = "20000000-0000-4000-8000-000000000001", id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
Deno.test("report: 2000 characters accepted, 2001 rejected (code points, trimmed)", () => {
  assertEquals(parseReport({ conversation_id: conv, category: "other", body: "x".repeat(2000) })?.body.length, 2000);
  assertEquals(parseReport({ conversation_id: conv, category: "other", body: "x".repeat(2001) }), null);
  assertEquals(parseReport({ conversation_id: conv, category: "other", body: "😀".repeat(2000) })?.body.length, 4000);
  assertEquals(parseReport({ conversation_id: conv, category: "other", body: "  " + "x".repeat(2000) + "  " })?.body.length, 2000);
});
Deno.test("report: at most 20 messages; needs text or a message; known category", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));
  assertEquals(parseReport({ conversation_id: conv, category: "harassment", body: "", message_ids: ids(20) })?.ids.length, 20);
  assertEquals(parseReport({ conversation_id: conv, category: "harassment", body: "", message_ids: ids(21) }), null);
  assertEquals(parseReport({ conversation_id: conv, category: "harassment", body: " " }), null);
  assertEquals(parseReport({ conversation_id: conv, category: "filter", body: "x" }), null);
  assertEquals(parseReport({ conversation_id: "nope", category: "other", body: "x" }), null);
});

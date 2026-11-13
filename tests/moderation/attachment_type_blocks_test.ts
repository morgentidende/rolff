import { assert } from "jsr:@std/assert@1";
Deno.test("send-attachment rejects declined types after the file type is known and before the model is called", async () => {
  const src = await Deno.readTextFile("supabase/functions/send-attachment/index.ts");
  const kind = src.indexOf("attachmentKind(fc.mime)");
  const flags = src.indexOf("recipient_attachment_blocks");
  const snap = src.indexOf("recipient_filter_snapshot");
  const ai = src.indexOf("await openaiFileModerate");
  const key = src.indexOf("Deno.env.get(\"OPENAI_API_KEY\")");
  assert(kind > 0 && flags > 0 && ai > 0 && key > 0, "expected markers");
  assert(flags < snap && kind < ai && flags < ai && flags < key, "type-block must run before AI and the API key check");
  assert(src.includes("return json({ status: typeBlock }, 200)"), "distinct blocked_photos/blocked_files status");
});

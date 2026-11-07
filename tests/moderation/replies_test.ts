import { normalizeReplyId } from "../../supabase/functions/_shared/replies.ts";
const upper = "ABCDEF01-1234-4567-89AB-ABCDEF012345";
const digest = async (id: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)))].join(",");
Deno.test("uppercase reply and identical retry have canonical PostgreSQL fingerprint", async () => {
  const first = normalizeReplyId(upper)!;
  const retry = normalizeReplyId(upper.toLowerCase())!;
  if (first !== upper.toLowerCase() || await digest(first) !== await digest(retry)) throw new Error("reply fingerprint differs");
});
Deno.test("old clients omit reply without changing null identity", () => {
  if (normalizeReplyId(undefined) !== null || normalizeReplyId(null) !== null) throw new Error("missing reply is not null");
});

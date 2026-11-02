import { assertStringIncludes } from "jsr:@std/assert@1";
import { checkPersonLimits } from "../../supabase/functions/_shared/limits.ts";
// fake admin: _send_limits returns a 140 limit by Q and a future next_at
const fake = (row: Record<string, unknown>) => {
  const q: any = new Proxy({}, { get: (_t, k) => k === "maybeSingle" || k === "single" ? async () => ({ data: { role: "participant", status: "active" }, error: null }) : k === "then" ? undefined : () => q });
  return { rpc: async () => ({ data: [row], error: null }), from: () => q };
};
Deno.test("length rejection carries limit and count", async () => {
  const r: any = await checkPersonLimits(fake({ max_chars: 140, chars_by: "q", next_at: null, next_by: null }) as any, "c", "p", 212);
  assertStringIncludes(JSON.stringify(r), '"limit":140'); assertStringIncludes(JSON.stringify(r), '"count":212');
});

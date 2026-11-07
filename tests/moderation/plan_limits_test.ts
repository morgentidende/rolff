const assertEquals = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
import { checkPlanLength, planLengthError } from "../../supabase/functions/_shared/planLimits.ts";
import { effectiveCharLimit, messageCharCount } from "../../apps/web/src/composerLimits.ts";
const admin = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });
Deno.test("49:160/161 and79:480/481 before AI", async () => {
  for (const cap of [160,480]) {
    assertEquals(await checkPlanLength(admin(cap), "fake", cap), null);
    assertEquals(await checkPlanLength(admin(cap), "fake", cap+1), {status:"plan_length_limit",limit:cap,count:cap+1});
  }
});
Deno.test("plan lookup errors/unknown values fail closed", async () => {
  for (const data of [null, 0, 10000, "480"]) assertEquals(await checkPlanLength(admin(data),"fake",1), "error");
  assertEquals(await checkPlanLength(admin(480,{}),"fake",1),"error");
});
Deno.test("Unicode code points and stricter recipient limits", () => {
  assertEquals(messageCharCount("æøå𐀀"),4); assertEquals(messageCharCount("e\u0301"),2);
  for (const [plan,cap] of [["text",160],["text_attachments",480]] as const) {
    assertEquals(effectiveCharLimit(plan,null),cap); assertEquals(effectiveCharLimit(plan,140),140);
    assertEquals(effectiveCharLimit(plan,250),Math.min(cap,250)); assertEquals(effectiveCharLimit(plan,10000),cap);
  }
});
Deno.test("commit-time downgrade has precise actionable quota", () => {
  assertEquals(planLengthError("plan_length_limit:160",200),{status:"plan_length_limit",limit:160,count:200});
  assertEquals(planLengthError("approval_invalid",200),null);
});

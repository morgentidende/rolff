import { checkPersonLimits } from "../../supabase/functions/_shared/limits.ts";
const eq=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)};
const fake = (row: Record<string, unknown>, error: unknown = null) => {
  const q: any = new Proxy({}, { get: (_t, k) => k === "maybeSingle" || k === "single" ? async () => ({ data: { role: "participant" }, error: null }) : k === "then" ? undefined : () => q });
  return { rpc: async () => ({ data: [row], error }), from: () => q };
};
Deno.test("Legacy recipient length is ignored before AI; sender plan checked separately", async () => {
  for(const chars of [160,212,480]) eq(await checkPersonLimits(fake({max_chars:140,chars_by:"q",next_at:null,next_by:null}),"c","p",chars),null);
});
Deno.test("Recipient frequency remains enforced even with stale length metadata", async () => {
  const r=await checkPersonLimits(fake({max_chars:140,next_at:"2030-01-01T00:00:00Z",next_by:"q"}),"c","p",480);
  if(!r || typeof r!=="object" || r.status!=="frequency_limit" || r.by!=="q" || !(Number(r.retry_after_s)>0))throw new Error("Frequency guard lost");
});
Deno.test("Frequency RPC errors still fail closed",async()=>eq(await checkPersonLimits(fake({},{}),"c","p",160),"error"));
Deno.test("Recipient settings have frequency only; composer uses sender plan only",async()=>{
  const app=await Deno.readTextFile("apps/web/src/App.tsx");
  const settings=app.slice(app.indexOf("function PersonSettings("),app.indexOf("// ---------- Add to home screen"));
  for(const removed of ["Maks. længde på beskeder","Max message length","setLen(","LEN_MIN","max_chars: mc"])if(settings.includes(removed))throw new Error("Retired length control remains");
  if(!settings.includes("Hvor ofte må der komme en besked")||!settings.includes("p_max_chars: null"))throw new Error("Frequency compatibility contract missing");
  if(!app.includes("effectiveCharLimit(plan)")||app.includes("lim?.max_chars"))throw new Error("Composer still restricted by recipient");
});

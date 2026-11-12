// Use the library's documented request-generation API, NEVER its network helper.
// Deno's node:crypto support is exercised by the network-denied synthetic test.
import process from "node:process";
// http_ece has an opt-in key logger: refuse to import it if accidentally configured.
if(process.env.ECE_KEYLOG === "1")throw Error("unsafe_push_logging_configuration");
const webpush=(await import("npm:web-push@3.6.7")).default;
import { outcome, pushLang, validPrepared, handoffFresh, type Authorize, type Prepared, type Outcome } from "./policy.ts";
export type Vapid = {subject:string;publicKey:string;privateKey:string};
export async function sendPush(p:Prepared,vapid:Vapid,authorize:Authorize,send:typeof fetch=fetch):Promise<Outcome> {
  if (!validPrepared(p)) return "deferred";
  let details;
  try {
    details=webpush.generateRequestDetails({endpoint:p.endpoint,keys:p.keys},JSON.stringify({v:1,binding:p.binding,l:pushLang(p),expires:Date.now()+30000}),{
      vapidDetails:vapid,TTL:0,contentEncoding:"aes128gcm",urgency:"normal",topic:"rolff-ready",
    });
  } catch {return "permanent";}
  if (details.endpoint!==p.endpoint || details.method!=="POST" || !details.body || details.body.length>2048 || !validPrepared(p)) return "deferred";
  // All crypto and body construction happens BEFORE the final authorization RPC.
  const body=new Uint8Array(details.body);
  const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",body))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const startMono=performance.now(),startWall=Date.now();
  const intent=await authorize(hash);
  if(!handoffFresh(intent,startMono,startWall,performance.now(),Date.now()))return intent?"expired":"deferred";
  // This is the first network handoff attempt. No async work or queue follows authorization.
  // The committed intent is NOT a claim that the provider/OS has received anything.
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),5000);
  try {
    if(!handoffFresh(intent,startMono,startWall,performance.now(),Date.now()))return "expired";
    const r=await send(details.endpoint,{method:"POST",headers:details.headers,body,redirect:"error",signal:abort.signal});
    // Never read/log provider body or Location; cancel even an unbounded stream.
    const result=outcome(r.status);void r.body?.cancel().catch(()=>{});return result;
  } catch {return "retry";} finally {clearTimeout(timer);abort.abort();}
}

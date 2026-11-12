import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { Buffer } from "node:buffer";
import { sendPush } from "../../supabase/functions/notification-dispatch/transport.ts";
import { validEndpoint,outcome,handoffFresh,pushLang, type Prepared } from "../../supabase/functions/notification-dispatch/policy.ts";
import { dispatch } from "../../supabase/functions/notification-dispatch/worker.ts";
// Known, deterministic PUBLIC test scalars (not deployable secrets). Never generate production keys here.
const raw=(n:number)=>{const e=createECDH("prime256v1");e.setPrivateKey(Buffer.alloc(32,n));return e.getPublicKey().toString("base64url");};
const vapid={subject:"https://example.invalid/contact",publicKey:raw(1),privateKey:Buffer.alloc(32,1).toString("base64url")};
const allow=async()=>({id:"40000000-0000-4000-8000-000000000004",valid_for_ms:750});
const prepared=():Prepared=>({endpoint:"https://fcm.googleapis.com/fcm/send/SyntheticOnly",keys:{p256dh:raw(2),auth:Buffer.alloc(16,3).toString("base64url")},binding:"10000000-0000-4000-8000-000000000001",prepared_at:new Date().toISOString(),expires_at:new Date(Date.now()+1000).toISOString()});
Deno.test("provider endpoints: supported exact HTTPS only",()=>{
 for(const e of ["https://fcm.googleapis.com/fcm/send/Synthetic:Only","https://updates.push.services.mozilla.com/wpush/v2/SyntheticOnly","https://updates.push.services.mozilla.com/wpush/v1/SyntheticOnly","https://web.push.apple.com/SyntheticOnly"])assert(validEndpoint(e));
 for(const e of ["http://fcm.googleapis.com/fcm/send/Synthetic","https://127.0.0.1/push","https://[::1]/push","https://169.254.169.254/push","https://fcm.googleapis.com.evil.invalid/fcm/send/Synthetic","https://fcm.googleapis.com@127.0.0.1/fcm/send/Synthetic","https://fcm.googleapis.com:443/fcm/send/Synthetic","https://fcm.googleapis.com/fcm/send/%2e%2e","https://fcm.googleapis.com/fcm/send/Synthetic?x=1","https://fcm.googleapis.com/fcm/send/Synthetic#fragment","https://fcm.googleapis.com/fcm/send//Synthetic","https://fcm.googleapis.com/fcm/send/"+"A".repeat(2048)])assert(!validEndpoint(e),"must reject URL");
});
Deno.test("documented web-push API generates real AES128GCM/VAPID bytes without any network",async()=>{
 let calls=0;
 const result=await sendPush(prepared(),vapid,allow,async(url,options)=>{
  calls++;assert.equal(url,prepared().endpoint);assert.equal(options?.redirect,"error");assert.equal(options?.method,"POST");
  const headers=new Headers(options?.headers);assert.equal(headers.get("ttl"),"0");assert.equal(headers.get("content-encoding"),"aes128gcm");assert(headers.get("authorization")?.startsWith("vapid t="));assert.equal(headers.get("topic"),"rolff-ready");
  const bytes=options?.body as Uint8Array;assert(bytes instanceof Uint8Array);assert(bytes.byteLength<2048);assert(!new TextDecoder().decode(bytes).includes("SyntheticOnly"));
  return new Response(null,{status:201});
 });assert.equal(result,"accepted");assert.equal(calls,1);
});
Deno.test("expired or malicious authorization cannot reach transport",async()=>{
 let calls=0;const send=async()=>{calls++;throw Error("network must never run");};
 const old=prepared();old.expires_at=new Date(Date.now()-1).toISOString();assert.equal(await sendPush(old,vapid,allow,send),"deferred");
 const malicious=prepared();malicious.endpoint="https://127.0.0.1/secret";assert.equal(await sendPush(malicious,vapid,allow,send),"deferred");assert.equal(calls,0);
});
Deno.test("404/410 cleanup, transient retry and permanent failures classified",()=>{
 for(const n of [200,201,202])assert.equal(outcome(n),"accepted");for(const n of [404,410])assert.equal(outcome(n),"gone");for(const n of [408,429,500,502,503])assert.equal(outcome(n),"retry");for(const n of [301,302,307,400,401,403,413])assert.equal(outcome(n),"permanent");
});
Deno.test("response bodies cancelled without reading capability-containing errors",async()=>{
 let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});
 assert.equal(await sendPush(prepared(),vapid,allow,async()=>new Response(stream,{status:410})),"gone");assert(cancelled);
});
Deno.test("network exception never reflected or logged",async()=>{
 assert.equal(await sendPush(prepared(),vapid,allow,()=>Promise.reject(Error("Synthetic sensitive endpoint must not escape"))),"retry");
});
Deno.test("worker normal release before claim; fresh prepare before each send",async()=>{
 const steps:string[]=[];let seq=0;
 const result=await dispatch(async(name,args)=>{
   steps.push(name);
   if(name==="claim_push_work")return {data:[{job_id:1,subscription_id:"one",lease:"lease1"},{job_id:2,subscription_id:"two",lease:"lease2"}],error:null};
   if(name==="prepare_push")return {data:++seq===1?prepared():null,error:null};
   if(name==="handoff_push")return {data:await allow(),error:null};
   if(name==="finish_push")assert.equal(args?.p_outcome,seq===1?"accepted":"deferred");
   return {data:null,error:null};
 },async(_p,authorize)=>{await authorize("a".repeat(64));steps.push("transport");return "accepted";});
 assert.deepEqual(steps,["push_release_tick","claim_push_work","prepare_push","handoff_push","transport","finish_push","prepare_push","finish_push","cleanup_push_work"]);assert.equal(result.accepted,1);assert.equal(result.deferred,1);
});
Deno.test("worker claim bounded at ten and never uses force release",async()=>{
 let sends=0;
 await dispatch(async(name,args)=>{assert(!JSON.stringify(args??{}).includes("force"));return {error:null,data:name==="claim_push_work"?Array.from({length:20},(_,i)=>({job_id:i,subscription_id:"s",lease:"l"})):name==="prepare_push"?prepared():name==="handoff_push"?await allow():null};},async(_p,authorize)=>{await authorize("a".repeat(64));sends++;return "accepted";});assert.equal(sends,10);
});
Deno.test("failed preparation never transports; failed finish stops and lease recovers",async()=>{
 let sends=0;await assert.rejects(dispatch(async(name)=>({data:name==="claim_push_work"?[{job_id:1,subscription_id:"s",lease:"l"}]:null,error:name==="prepare_push"||name==="finish_push"?{}:null}),async()=>{sends++;return "accepted";}),/finish_failed/);assert.equal(sends,0);
});

Deno.test("transport hard deadline aborts a stalled provider without response data",async()=>{
 const start=Date.now();const result=await sendPush(prepared(),vapid,allow,(_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener("abort",()=>reject(Error("aborted")))));
 assert.equal(result,"retry");assert(Date.now()-start>=4900);assert(Date.now()-start<6500);
});

Deno.test("late authorization response expires without network; monotonic interval starts before RPC",async()=>{
 let sends=0;const result=await sendPush(prepared(),vapid,async()=>{await new Promise(r=>setTimeout(r,120));return {...await allow(),valid_for_ms:100};},async()=>{sends++;return new Response(null,{status:201});});
 assert.equal(result,"expired");assert.equal(sends,0);
});
Deno.test("final authorization rejection after encryption prevents all physical sends",async()=>{
 let authorizations=0,sends=0;const result=await sendPush(prepared(),vapid,async hash=>{authorizations++;assert.match(hash,/^[0-9a-f]{64}$/);return null;},async()=>{sends++;return new Response();});
 assert.equal(result,"deferred");assert.equal(authorizations,1);assert.equal(sends,0);
});
Deno.test("conservative relative deadline tolerates offsets, rejects backwards/forwards jumps and elapsed queue time",async()=>{
 const h=await allow();assert(handoffFresh(h,500,1000000,510,1000010));
 assert(!handoffFresh(h,500,1000000,500,999900));assert(!handoffFresh(h,500,1000000,400,1000010));
 assert(!handoffFresh(h,500,1000000,1201,1000701));assert(!handoffFresh(h,500,1000000,510,1000800));
 assert(!handoffFresh({...h,valid_for_ms:751},500,0,501,1));assert(!handoffFresh({...h,valid_for_ms:40},500,0,501,1));
});
Deno.test("a worker cannot request the same intent twice, or finalize a claimed-only task as accepted",async()=>{
 let authorizations=0;const result=await dispatch(async name=>({data:name==="claim_push_work"?[{job_id:1,subscription_id:"s",lease:"l"}]:name==="prepare_push"?prepared():name==="handoff_push"?(authorizations++,await allow()):null,error:null}),async(_p,authorize)=>{assert(await authorize("a".repeat(64)));assert.equal(await authorize("b".repeat(64)),null);return "accepted";});
 assert.equal(authorizations,1);assert.equal(result.accepted,1);
});
Deno.test("a transport adapter cannot report acceptance from a claim without a handoff",async()=>{
 const result=await dispatch(async name=>({data:name==="claim_push_work"?[{job_id:1,subscription_id:"s",lease:"l"}]:name==="prepare_push"?prepared():null,error:null}),async()=>"accepted");assert.equal(result.accepted,0);assert.equal(result.deferred,1);
});
Deno.test("notification language: only explicit en is English, everything else Danish",()=>{
  if(pushLang({lang:"en"})!=="en" || pushLang({lang:"da"})!=="da" || pushLang({})!=="da" || pushLang({lang:"EN"})!=="da" || pushLang({lang:"xx"})!=="da")throw Error("pushLang");
});

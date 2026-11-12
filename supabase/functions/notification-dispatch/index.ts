import { createClient } from "jsr:@supabase/supabase-js@2";
import { dispatch } from "./worker.ts";
import { sendPush } from "./transport.ts";
// Existing app convention: independent server-only cron bearer, not a client JWT.
Deno.serve(async(req:Request)=>{
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const secret=Deno.env.get("PUSH_CRON_SECRET")??"";
  if(req.method!=="POST" || secret.length<32 || req.headers.get("x-cron-secret")!==secret) return reply({error:"forbidden"},403);
  if(Deno.env.get("WEB_PUSH_ENABLED")!=="true")return reply({disabled:true});
  const url=Deno.env.get("SUPABASE_URL")??"";
  // Fail closed on wrong project. The unrelated installed connector must never be used.
  if(url!=="https://dubwlbqazbllnwpsqrjv.supabase.co")return reply({error:"configuration"},503);
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}"))[0] as string;
  const vapid={publicKey:Deno.env.get("VAPID_PUBLIC_KEY")??"",privateKey:Deno.env.get("VAPID_PRIVATE_KEY")??"",subject:Deno.env.get("VAPID_SUBJECT")??""};
  if(!key || !/^B[A-Za-z0-9_-]{86}$/.test(vapid.publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(vapid.privateKey) || !/^https:\/\/[^\s]+$|^mailto:[^\s]+@[^\s]+$/.test(vapid.subject))return reply({error:"configuration"},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try {return reply(await dispatch(async(name,args)=>await admin.rpc(name,args).abortSignal(AbortSignal.timeout(10000)),(p,authorize)=>sendPush(p,vapid,authorize)));}
  catch {return reply({error:"worker_failed"},503);} // No raw SDK/crypto/provider exception logs.
});

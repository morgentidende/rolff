import { createClient } from "@supabase/supabase-js";
import { PushController, type Binding, type PushOwner } from "./pushController";
export const pushBuildEnabled=import.meta.env?.VITE_WEB_PUSH_ENABLED==="true";
let registration:Promise<ServiceWorkerRegistration>|null=null;
function ready(){
 if(!registration)registration=navigator.serviceWorker.register(new URL("./sw.js",document.baseURI),{scope:new URL("./",document.baseURI).pathname,updateViaCache:"none"}).then(async r=>{
   if(r.active)return r;
   return new Promise<ServiceWorkerRegistration>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("worker_timeout")),10000);const w=r.installing??r.waiting;if(!w){clearTimeout(timer);reject(Error("worker_missing"));return;}const check=()=>{if(w.state==="activated"){clearTimeout(timer);resolve(r);}else if(w.state==="redundant"){clearTimeout(timer);reject(Error("worker_failed"));}};w.addEventListener("statechange",check);check();});
 });
 return registration;
}
async function message(type:string,data:Record<string,unknown>={}):Promise<any>{
 const r=await ready();if(!r.active)throw Error("worker_missing");
 return new Promise((resolve,reject)=>{const c=new MessageChannel(),timer=setTimeout(()=>{c.port1.close();reject(Error("worker_timeout"));},5000);c.port1.onmessage=e=>{clearTimeout(timer);c.port1.close();e.data?.ok?resolve(e.data.value):reject(Error("worker_failed"));};r.active!.postMessage({type,...data},[c.port2]);});
}
export const supportedPush=()=>typeof window!=="undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const controller=new PushController({
 supported:supportedPush,online:()=>navigator.onLine,permission:()=>"Notification" in window?Notification.permission:"default",
 requestPermission:()=>Notification.requestPermission(),
 identity:async owner=>{if(!supportedPush())return {owner,fence:"unsupported",binding:null};return await message("IDENTITY",{owner}) as Binding;},
 current:async()=>supportedPush()?await message("READ") as Binding:{owner:null,fence:"unsupported",binding:null},
 bind:async(fence,binding)=>await message("BIND",{fence,binding}),
 clear:async fence=>{if(supportedPush())await message("CLEAR",{fence});},
 subscription:async(key,replace,expected)=>{
   const unchanged=async()=>{const current=await message("READ") as Binding;if(current.owner!==expected.owner || current.fence!==expected.fence)throw Error("auth_changed");};
   const r=await ready();await unchanged();let sub=await r.pushManager.getSubscription();await unchanged();
   if(sub && replace){await unchanged();await sub.unsubscribe();sub=null;await unchanged();}
   if(!sub){await unchanged();sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});await unchanged();}
   const json=sub.toJSON();if(!json.endpoint || !json.keys?.auth || !json.keys?.p256dh)throw Error("subscription_failed");
   return {endpoint:json.endpoint,keys:{auth:json.keys.auth,p256dh:json.keys.p256dh}};
 },
 rpc:async(owner,name,args)=>{
   // Frozen owner token; never use shared callFn(), getSession() after an await, or refresh it.
   const client=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${owner.token}`}}});
   const {data,error}=await client.rpc(name,args).abortSignal(AbortSignal.timeout(10000));if(error)throw Error("server_failed");return data;
 },
});
export const pushController=controller;
export function setPushOwner(owner:PushOwner|null){
 // Always clear an existing local worker binding on logout, even after a disabled build.
 if(pushBuildEnabled)controller.setOwner(owner);
 else if(!owner && "serviceWorker" in navigator)void navigator.serviceWorker.getRegistration(new URL("./",document.baseURI).href).then(r=>r?.active?.postMessage({type:"IDENTITY",owner:null})).catch(()=>{});
}

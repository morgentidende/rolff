import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { detectTimezone } from "./timezones";
export type ReceiveWindow = { weekday:number; start_minute:number; end_minute:number };
export type ReceiveSettingsState = { configured:boolean; timezone:string|null; mode:"auto"|"fixed"; revision:number; enabled:boolean; windows:ReceiveWindow[]; is_controller:boolean; synced_at:string|null };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function timezoneDevice(uid:string): string|null {
  try { const key=`rolff:timezone-device:${uid}`; const old=localStorage.getItem(key); if (old && uuid.test(old)) return old; const id=crypto.randomUUID(); localStorage.setItem(key,id); return localStorage.getItem(key)===id ? id : null; } catch { return null; }
}
let identity:string|null=null, authEpoch=0;
const requests=new Set<AbortController>();
export function setReceiveTimezoneUser(uid:string|null):void {
  if(identity===uid)return;
  identity=uid;authEpoch++;pending.clear();for(const request of requests)request.abort();requests.clear();
}
async function rpc(uid:string,name:string,args:Record<string,unknown>):Promise<ReceiveSettingsState> {
  const epoch=authEpoch; const session=(await supabase.auth.getSession()).data.session;
  if(!session || session.user.id!==uid || identity!==uid || epoch!==authEpoch)throw new Error("auth_changed");
  // Pin this operation to its verified account. The shared client's session can
  // change while a request is queued; it must never lend another account's JWT.
  const scoped=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${session.access_token}`}}});
  const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),10000);
  try {
    const {data,error}=await scoped.rpc(name,args).abortSignal(controller.signal);
    if(identity!==uid || epoch!==authEpoch)throw new Error("auth_changed");
    if(error)throw error;if(!data||typeof data!=="object")throw new Error("invalid_receive_settings_response");return data as ReceiveSettingsState;
  } finally {clearTimeout(timer);requests.delete(controller);}
}
export async function readReceiveSettings(uid:string):Promise<ReceiveSettingsState> {
  if ((await supabase.auth.getSession()).data.session?.user.id!==uid) throw new Error("unauthenticated");
  return rpc(uid,"get_my_receive_settings",{p_device_id:timezoneDevice(uid)});
}
export function saveReceiveSettings(uid:string,base:ReceiveSettingsState,changes:{enabled:boolean;windows:ReceiveWindow[];mode:"auto"|"fixed";timezone:string;takeOver:boolean}):Promise<ReceiveSettingsState> {
  return rpc(uid,"save_my_receive_settings",{p_enabled:changes.enabled,p_windows:changes.windows,p_mode:changes.mode,p_timezone:changes.timezone,p_device_id:timezoneDevice(uid),p_expected_revision:base.revision,p_take_over:changes.takeOver});
}
const pending=new Map<string,{zone:string|null;at:number;task:Promise<ReceiveSettingsState|null>}>();
export const invalidateReceiveTimezone=(uid:string)=>{ pending.delete(uid); };
/** No GPS/background promises: only an open, online app syncs its chosen device. */
export function syncReceiveTimezone(uid:string,force=false):Promise<ReceiveSettingsState|null> {
  if (!navigator.onLine) return Promise.resolve(null);
  if(identity!==uid)return Promise.resolve(null);
  const zone=detectTimezone(); const before=pending.get(uid);
  if (before && (Date.now()-before.at<60000) && before.zone===zone && !force) return before.task;
  // Keep concurrent first-load/foreground requests in the same transaction stream.
  const run=async():Promise<ReceiveSettingsState|null>=>{
    try {
      let s=await readReceiveSettings(uid); const device=timezoneDevice(uid);
      if (!s.configured && zone && device) {
        try { s=await saveReceiveSettings(uid,s,{enabled:false,windows:[],mode:"auto",timezone:zone,takeOver:false}); }
        catch { return await readReceiveSettings(uid); } // Another device may have configured it first; never overwrite.
      } else if (s.mode==="auto" && s.is_controller && zone && s.timezone!==zone) {
        try { s=await rpc(uid,"sync_my_receive_timezone",{p_timezone:zone,p_device_id:device,p_expected_revision:s.revision}); }
        catch { return await readReceiveSettings(uid); } // Keep the latest confirmed server choice on conflict/error.
      }
      return s;
    } catch { return null; }
  };
  const task=before && force ? before.task.then(run) : run();
  pending.set(uid,{zone,at:Date.now(),task}); return task;
}

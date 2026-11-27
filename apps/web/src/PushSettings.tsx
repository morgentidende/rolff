import { useCallback, useEffect, useRef, useState } from "react";
import { CardSkeleton } from "./CardSkeleton";
import { peekCard, putCard } from "./cardCache";
import { prewarmPush, pushBuildEnabled, pushController, supportedPush } from "./push";
import type { PushState } from "./pushController";
import type { Lang } from "./i18n";
const errors:Record<string,[string,string]>={
 unsupported:["Notifikationer virker ikke her. På iPhone skal Rolff føjes til hjemmeskærmen.","Notifications do not work here. On iPhone, add Rolff to the Home Screen."],
 denied:["Åbn Indstillinger, og tillad notifikationer til Rolff.","Open Settings and allow notifications for Rolff."],
 offline:["Du er offline. Notifikationer er ikke slået til på serveren.","You are offline. Notifications have not been enabled on the server."],
 unavailable:["Notifikationer er ikke tilgængelige endnu.","Notifications are not available yet."],
};
const failedChange=["Ændringen kunne ikke bekræftes. Prøv igen.","The change could not be confirmed. Try again."];
export function PushSettings({uid,lang,onboarding=false}:{uid:string;lang:Lang;onboarding?:boolean}){
 const da=lang==="da",cached=peekCard<{state:PushState;active:boolean;binding:string|null}>(`push:${uid}`),[state,setState]=useState<PushState|null>(cached?.state??null),[active,setActive]=useState(cached?.active??false),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(""),[dismissed,setDismissed]=useState(false);
 const pendingRef=useRef(false);
 const load=useCallback(async()=>{if(!pushBuildEnabled)return;if(pendingRef.current)return;try{const r=await pushController.state();if(pendingRef.current)return;putCard(`push:${uid}`,{state:r.state,active:r.active,binding:r.binding??null});setState(r.state);setActive(r.active);}catch{if(pendingRef.current)return;setState(null);setError(da?"Status kunne ikke hentes. Prøv igen senere.":"Could not load status. Try again later.");}},[uid,da]);
 useEffect(()=>{prewarmPush();},[]);
 useEffect(()=>{let live=true; // component is owner-keyed; controller also fences every await
   if(live)void load();const update=()=>{if(live)void load();};
   navigator.serviceWorker?.addEventListener("message",update);window.addEventListener("focus",update);
   return()=>{live=false;navigator.serviceWorker?.removeEventListener("message",update);window.removeEventListener("focus",update);};
 },[load]);
 const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();await load();}catch(e){const code=e instanceof Error?e.message:"";setError(errors[code]?.[da?0:1]??failedChange[da?0:1]);setActive(false);}finally{setBusy(false);}};
 if(onboarding && (!pushBuildEnabled || !state?.available || state.offered || dismissed))return null;
 if(!pushBuildEnabled || (state && !state.available))return <p role="status">{errors.unavailable[da?0:1]}</p>;
 if(!state)return error?<p role="status">{error}</p>:<CardSkeleton lang={lang} label={da?"Henter status…":"Loading status…"} minHeight={120} rows={[40,"gap",40]} />;
 const lead=da?"Viser afsenderens navn, men aldrig beskedteksten. Slået fra som standard.":"Shows the sender's name, but never the message text. Off by default.";
 if(onboarding)return <section className="card push-offer" aria-label={da?"Notifikationer":"Notifications"}>
   <h3>{da?"Vil du have besked om nye beskeder?":"Would you like new-message notifications?"}</h3>
   <p className="push-lead">{lead} {da?"Du kan ændre det under Menu → Notifikationer.":"You can change it under Menu → Notifications."}</p>
   {!supportedPush() && <p className="meta" role="status">{errors.unsupported[da?0:1]}</p>}
   {error && <p className="err" role="alert">{error}</p>}
   <div className="row end">
     <button className="ghost" disabled={busy} onClick={()=>{setDismissed(true);void perform(()=>pushController.decline());}}>{da?"Ikke nu":"Not now"}</button>
     <button disabled={busy||!supportedPush()} onClick={()=>void perform(()=>pushController.enable(state))}>{da?"Ja":"Yes"}</button>
   </div>
 </section>;
 const denied=typeof Notification!=="undefined" && Notification.permission==="denied", supported=supportedPush();
 // Do not disable or dim the switch while a change is in flight — ignore extra taps instead.
 const canToggle=active||(supported&&!denied);
 const blurPointer=(e:React.PointerEvent<HTMLButtonElement>)=>{if(e.pointerType==="touch"||e.pointerType==="pen")e.currentTarget.blur();};
 const toggle=()=>{
  if(pendingRef.current||!canToggle)return;
  const next=!active;
  pendingRef.current=true;setPending(true);setError("");setActive(next);
  void (async()=>{
   try{
    if(next)await pushController.enable(state);else await pushController.disable();
    const r=await pushController.state();
    if(!pendingRef.current)return;
    putCard(`push:${uid}`,{state:r.state,active:r.active,binding:r.binding??null});
    setState(r.state);setActive(r.active);
   }catch(e){
    const code=e instanceof Error?e.message:"";
    setError(errors[code]?.[da?0:1]??failedChange[da?0:1]);
    setActive(!next);
   }finally{pendingRef.current=false;setPending(false);}
  })();
 };
 const line=denied?errors.denied[da?0:1]:!supported?errors.unsupported[da?0:1]:(da?"Du får besked, når der kommer nye beskeder.":"You get notified when new messages arrive.");
 return <section className="push-settings" aria-label={da?"Notifikationer":"Notifications"}>
   {/* The sheet title already says "Notifikationer"; the row repeats that name as the single control, WhatsApp-style. */}
   <div className="setting-row">
     <div className="setting-text"><span className="setting-title" id="push-toggle-label">{da?"Notifikationer":"Notifications"}</span></div>
     <button type="button" role="switch" className="toggle-switch" aria-checked={active} aria-labelledby="push-toggle-label" disabled={!canToggle} aria-busy={pending||undefined} onClick={toggle} onPointerUp={blurPointer}><span className="switch-knob" aria-hidden="true"/></button>
   </div>
   <p className="push-lead" role="status">{line}</p>
   {error && <p className="err" role="alert">{error}</p>}
 </section>;
}

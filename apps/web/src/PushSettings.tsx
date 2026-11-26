import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "./CardSkeleton";
import { peekCard, putCard } from "./cardCache";
import { pushBuildEnabled, pushController, supportedPush } from "./push";
import type { PushState } from "./pushController";
import type { Lang } from "./i18n";
import { confirmDialog } from "./confirmDialog";
const errors:Record<string,[string,string]>={
 unsupported:["Notifikationer virker ikke her. På iPhone skal Rolff føjes til hjemmeskærmen.","Notifications do not work here. On iPhone, add Rolff to the Home Screen."],
 denied:["Åbn Indstillinger, og tillad notifikationer til Rolff.","Open Settings and allow notifications for Rolff."],
 offline:["Du er offline. Notifikationer er ikke slået til på serveren.","You are offline. Notifications have not been enabled on the server."],
 unavailable:["Notifikationer er ikke tilgængelige endnu.","Notifications are not available yet."],
};
export function PushSettings({uid,lang,onboarding=false}:{uid:string;lang:Lang;onboarding?:boolean}){
 const da=lang==="da",cached=peekCard<{state:PushState;active:boolean;binding:string|null}>(`push:${uid}`),[state,setState]=useState<PushState|null>(cached?.state??null),[active,setActive]=useState(cached?.active??false),[binding,setBinding]=useState<string|null>(cached?.binding??null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[dismissed,setDismissed]=useState(false);
 const load=useCallback(async()=>{if(!pushBuildEnabled)return;try{const r=await pushController.state();putCard(`push:${uid}`,{state:r.state,active:r.active,binding:r.binding??null});setState(r.state);setActive(r.active);setBinding(r.binding??null);}catch{setState(null);setError(da?"Status kunne ikke hentes. Prøv igen senere.":"Could not load status. Try again later.");}},[uid,da]);
 useEffect(()=>{let live=true; // component is owner-keyed; controller also fences every await
   if(live)void load();const update=()=>{if(live)void load();};
   navigator.serviceWorker?.addEventListener("message",update);window.addEventListener("focus",update);
   return()=>{live=false;navigator.serviceWorker?.removeEventListener("message",update);window.removeEventListener("focus",update);};
 },[load]);
 const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();await load();}catch(e){const code=e instanceof Error?e.message:"";setError(errors[code]?.[da?0:1]??(da?"Ændringen kunne ikke bekræftes på serveren. Prøv igen senere.":"The change could not be confirmed on the server. Try again later."));setActive(false);}finally{setBusy(false);}};
 if(onboarding && (!pushBuildEnabled || !state?.available || state.offered || dismissed))return null;
 if(!pushBuildEnabled || (state && !state.available))return <p role="status">{errors.unavailable[da?0:1]}</p>;
 if(!state)return error?<p role="status">{error}</p>:<CardSkeleton lang={lang} label={da?"Henter status…":"Loading status…"} minHeight={220} rows={[90,75,"gap","button","gap",40]} />;
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
 const canToggle=!busy&&(active||(supported&&!denied));
 const toggle=()=>void perform(()=>active?pushController.disable():pushController.enable(state));
 const offAll=async()=>{if(await confirmDialog({title:da?"Slå fra på alle enheder?":"Turn off on all devices?",body:da?"Ingen af dine enheder får notifikationer, før du slår dem til igen.":"None of your devices will get notifications until you turn them on again.",confirm:da?"Slå fra":"Turn off",cancel:da?"Annuller":"Cancel",danger:true}))void perform(()=>pushController.disable(null,true));};
 const line=denied?errors.denied[da?0:1]:!supported?errors.unsupported[da?0:1]:(da?"Du får besked, når der kommer nye beskeder.":"You get notified when new messages arrive.");
 return <section className="push-settings" aria-label={da?"Notifikationer":"Notifications"}>
   {/* The sheet title already says "Notifikationer"; the row repeats that name as the single control, WhatsApp-style. */}
   <div className="setting-row">
     <div className="setting-text"><span className="setting-title" id="push-toggle-label">{da?"Notifikationer":"Notifications"}</span></div>
     <button type="button" role="switch" className="toggle-switch" aria-checked={active} aria-labelledby="push-toggle-label" disabled={!canToggle} aria-busy={busy||undefined} onClick={toggle}><span className="switch-knob" aria-hidden="true"/></button>
   </div>
   <p className="push-lead" role="status">{line}</p>
   {error && <p className="err" role="alert">{error}</p>}
   {state.devices.length>0 && <details className="push-devices">
     <summary>{da?"Enheder":"Devices"}</summary>
     <ul className="device-list">{state.devices.map((d,i)=>{const label=`${da?"Enhed":"Device"} ${i+1}`;return <li key={d.id}>
       <span className="device-text"><span className="device-name">{label}{d.id===binding&&<span className="tag">{da?"Denne enhed":"This device"}</span>}</span></span>
       <button type="button" className="text-link" disabled={busy} aria-label={`${da?"Fjern":"Remove"} ${label}`} onClick={()=>void perform(()=>pushController.disable(d.id))}>{da?"Fjern":"Remove"}</button></li>;})}</ul>
     <div className="sheet-danger-zone"><button type="button" className="text-danger" disabled={busy} onClick={()=>void offAll()}>{da?"Slå fra på alle enheder":"Turn off on all devices"}</button></div>
   </details>}
 </section>;
}

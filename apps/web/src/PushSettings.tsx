import { useCallback, useEffect, useState } from "react";
import { pushBuildEnabled, pushController, supportedPush } from "./push";
import type { PushState } from "./pushController";
import type { Lang } from "./i18n";
import { deniedHelp } from "./native/permissions";
import { deviceOf, runtime } from "./native/platform";
import { confirmDialog } from "./confirmDialog";
const errors:Record<string,[string,string]>={
 unsupported:["Browseren understøtter ikke web-notifikationer her. På iPhone/iPad kræves iOS/iPadOS 16.4+ og Rolff føjet til hjemmeskærmen.","Web notifications are not supported here. On iPhone/iPad use iOS/iPadOS 16.4+ and add Rolff to the Home Screen."],
 denied:["Notifikationer er blokeret i browserens eller telefonens indstillinger. Vi spørger ikke igen automatisk.","Notifications are blocked in browser or phone settings. We will not ask again automatically."],
 offline:["Du er offline. Notifikationer er ikke slået til på serveren.","You are offline. Notifications have not been enabled on the server."],
 unavailable:["Notifikationer er ikke tilgængelige endnu.","Notifications are not available yet."],
};
const day=(iso:string,da:boolean)=>{try{return new Date(iso).toLocaleDateString(da?"da-DK":"en-GB",{day:"numeric",month:"short",year:"numeric"});}catch{return iso.slice(0,10);}};
export function PushSettings({uid,lang,onboarding=false}:{uid:string;lang:Lang;onboarding?:boolean}){
 const da=lang==="da",[state,setState]=useState<PushState|null>(null),[active,setActive]=useState(false),[binding,setBinding]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[dismissed,setDismissed]=useState(false);
 const load=useCallback(async()=>{if(!pushBuildEnabled)return;try{const r=await pushController.state();setState(r.state);setActive(r.active);setBinding(r.binding??null);}catch{setState(null);setError(da?"Status kunne ikke hentes. Prøv igen senere.":"Could not load status. Try again later.");}},[uid,da]);
 useEffect(()=>{let live=true; // component is owner-keyed; controller also fences every await
   if(live)void load();const update=()=>{if(live)void load();};
   navigator.serviceWorker?.addEventListener("message",update);window.addEventListener("focus",update);
   return()=>{live=false;navigator.serviceWorker?.removeEventListener("message",update);window.removeEventListener("focus",update);};
 },[load]);
 const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();await load();}catch(e){const code=e instanceof Error?e.message:"";setError(errors[code]?.[da?0:1]??(da?"Ændringen kunne ikke bekræftes på serveren. Notifikationer er ikke bekræftet aktive. Prøv igen senere.":"The change could not be confirmed on the server. Notifications are not confirmed active. Try again later."));setActive(false);}finally{setBusy(false);}};
 if(onboarding && (!pushBuildEnabled || !state?.available || state.offered || dismissed))return null;
 if(!pushBuildEnabled || (state && !state.available))return <p role="status">{errors.unavailable[da?0:1]}</p>;
 if(!state)return <p role="status">{error||(da?"Henter status…":"Loading status…")}</p>;
 const lead=da?"Neutral besked uden afsender eller tekst. Slået fra som standard.":"A neutral notice with no sender or text. Off by default.";
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
 const mine=state.devices.find(d=>d.id===binding);
 const status=active?(da?"Aktiv":"On")+(mine?` · ${da?"fornyes senest":"renew by"} ${day(mine.expires_at,da)}`:""):denied?(da?"Blokeret i telefonens indstillinger":"Blocked in your phone settings"):!supported?(da?"Ikke understøttet her":"Not supported here"):(da?"Fra":"Off");
 const canToggle=!busy&&(active||(supported&&!denied));
 const toggle=()=>void perform(()=>active?pushController.disable():pushController.enable(state));
 const help=denied?deniedHelp("notifications",deviceOf(navigator.userAgent,runtime()),runtime(),da?"da":"en"):null;
 const offAll=async()=>{if(await confirmDialog({title:da?"Slå fra på alle enheder?":"Turn off on all devices?",body:da?"Ingen af dine enheder får notifikationer, før du slår dem til igen.":"None of your devices will get notifications until you turn them on again.",confirm:da?"Slå fra":"Turn off",cancel:da?"Annuller":"Cancel",danger:true}))void perform(()=>pushController.disable(null,true));};
 return <section className="push-settings" aria-label={da?"Notifikationer":"Notifications"}>
   {/* The sheet title already says "Notifikationer"; no second heading here. */}
   <p className="push-lead">{lead}</p>
   <div className="setting-row">
     <div className="setting-text"><span className="setting-title" id="push-toggle-label">{da?"Notifikationer på denne enhed":"Notifications on this device"}</span>
       <span className={`setting-status${active?" is-on":""}${denied?" is-blocked":""}`} id="push-toggle-status" role="status">{status}</span></div>
     <button type="button" role="switch" className="toggle-switch" aria-checked={active} aria-labelledby="push-toggle-label" aria-describedby="push-toggle-status" disabled={!canToggle} aria-busy={busy||undefined} onClick={toggle}><span className="switch-knob" aria-hidden="true"/></button>
   </div>
   {active && <button type="button" className="text-link push-renew" disabled={busy} onClick={()=>void perform(()=>pushController.enable(state))}>{da?"Forny tilmelding nu":"Renew registration now"}</button>}
   {!supported && <p className="meta" role="status">{errors.unsupported[da?0:1]}</p>}
   {error && <p className="err" role="alert">{error}</p>}
   {help && <div className="notice push-help" role="status"><strong>{help.title}</strong><ol className="permission-steps">{help.steps.map((x,i)=><li key={i}>{x}</li>)}</ol></div>}
   {state.devices.length>0 && <div className="push-devices">
     <h3 className="sheet-subhead">{da?"Tilmeldte enheder":"Registered devices"}</h3>
     <ul className="device-list">{state.devices.map((d,i)=>{const label=`${da?"Enhed":"Device"} ${i+1}`;return <li key={d.id}>
       <span className="device-text"><span className="device-name">{label}{d.id===binding&&<span className="tag">{da?"Denne enhed":"This device"}</span>}</span><span className="meta">{da?"Udløber":"Expires"} {day(d.expires_at,da)}</span></span>
       <button type="button" className="text-link" disabled={busy} aria-label={`${da?"Fjern":"Remove"} ${label}`} onClick={()=>void perform(()=>pushController.disable(d.id))}>{da?"Fjern":"Remove"}</button></li>;})}</ul>
     <p className="meta">{da?"Tilmeldinger udløber efter 90 dage. Enheder vises uden navn.":"Registrations expire after 90 days. Devices are shown without names."}</p>
   </div>}
   <details className="more">
     <summary>{da?"Mere om notifikationer":"More about notifications"}</summary>
     <p>{da?"Beskeden lyder altid “ROLFF — Du har nye beskeder klar.” Afsender og beskedtekst vises aldrig på låseskærmen.":"The notice always reads “ROLFF — You have new messages ready.” Sender and message text are never shown on the lock screen."}</p>
     <p>{da?"Har du modtagetider slået til, sendes en notifikation først, når beskederne frigives. En notifikation, der allerede er på vej, kan stadig nå frem, selv om du ændrer tider eller slår fra.":"If receive times are on, a notification is only sent once messages are released. A notification already on its way may still arrive after you change times or turn it off."}</p>
     <p>{da?"Browser, netværk og telefon kan forsinke eller undlade at vise notifikationen. Det præcise tidspunkt kan ikke garanteres.":"Browser, network and phone may delay or not show the notification. The exact time cannot be guaranteed."}</p>
   </details>
   {state.devices.length>0 && <div className="sheet-danger-zone"><button type="button" className="text-danger" disabled={busy} onClick={()=>void offAll()}>{da?"Slå fra på alle enheder":"Turn off on all devices"}</button></div>}
 </section>;
}

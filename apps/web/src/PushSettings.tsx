import { useCallback, useEffect, useState } from "react";
import { pushBuildEnabled, pushController, supportedPush } from "./push";
import type { PushState } from "./pushController";
import type { Lang } from "./i18n";
const errors:Record<string,[string,string]>={
 unsupported:["Browseren understøtter ikke web-notifikationer her. På iPhone/iPad kræves iOS/iPadOS 16.4+ og Rolff føjet til hjemmeskærmen.","Web notifications are not supported here. On iPhone/iPad use iOS/iPadOS 16.4+ and add Rolff to the Home Screen."],
 denied:["Notifikationer er blokeret i browserens eller telefonens indstillinger. Vi spørger ikke igen automatisk.","Notifications are blocked in browser or phone settings. We will not ask again automatically."],
 offline:["Du er offline. Notifikationer er ikke slået til på serveren.","You are offline. Notifications have not been enabled on the server."],
 unavailable:["Notifikationer er ikke tilgængelige endnu.","Notifications are not available yet."],
};
export function PushSettings({uid,lang,onboarding=false}:{uid:string;lang:Lang;onboarding?:boolean}){
 const da=lang==="da",[state,setState]=useState<PushState|null>(null),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[dismissed,setDismissed]=useState(false);
 const load=useCallback(async()=>{if(!pushBuildEnabled)return;try{const r=await pushController.state();setState(r.state);setActive(r.active);}catch{setState(null);setError(da?"Status kunne ikke hentes. Prøv igen senere.":"Could not load status. Try again later.");}},[uid,da]);
 useEffect(()=>{let live=true; // component is owner-keyed; controller also fences every await
   if(live)void load();const update=()=>{if(live)void load();};
   navigator.serviceWorker?.addEventListener("message",update);window.addEventListener("focus",update);
   return()=>{live=false;navigator.serviceWorker?.removeEventListener("message",update);window.removeEventListener("focus",update);};
 },[load]);
 const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();await load();}catch(e){const code=e instanceof Error?e.message:"";setError(errors[code]?.[da?0:1]??(da?"Ændringen kunne ikke bekræftes på serveren. Notifikationer er ikke bekræftet aktive. Prøv igen senere.":"The change could not be confirmed on the server. Notifications are not confirmed active. Try again later."));setActive(false);}finally{setBusy(false);}};
 if(onboarding && (!pushBuildEnabled || !state?.available || state.offered || dismissed))return null;
 if(!pushBuildEnabled || (state && !state.available))return <p role="status">{errors.unavailable[da?0:1]}</p>;
 if(!state)return <p role="status">{error||(da?"Henter status…":"Loading status…")}</p>;
 return <section className={onboarding?"card":""} aria-label={da?"Notifikationer":"Notifications"}>
   <h3>{onboarding?(da?"Vil du have besked om nye beskeder?":"Would you like new-message notifications?"):(da?"Notifikationer":"Notifications")}</h3>
   <p>{da?"Valgfrit og slået fra, indtil du selv slår det til. Kun en neutral besked: “ROLFF — Du har nye beskeder klar.” Ingen afsender eller beskedtekst på låseskærmen. Du kan ændre dit valg her senere.":"Optional and off until you turn it on. Only a generic notice: “ROLFF — You have new messages ready.” No sender or message text on the lock screen. You can change your choice here later."}</p>
   <p className="meta">{da?"Vi starter kun en afsendelse efter frigivelse og kontrol af dine aktuelle modtagetider, hvis de er slået til. En afsendelse, der allerede er sat i gang, kan stadig nå frem, selv om du ændrer tider eller slår fra. Browser, netværk og telefon kan forsinke eller undlade visning; præcis visningstid kan ikke garanteres.":"A dispatch starts only after release and a check of your current receive times, if enabled. A dispatch already started may still arrive after you change times or disable notifications. Browser, network and phone may delay or omit display; exact display time cannot be guaranteed."}</p>
   {!supportedPush() && <p role="status">{errors.unsupported[da?0:1]}</p>}
   {!onboarding && <p role="status">{active?(da?"Aktiv på denne enhed (bekræftet på serveren).":"Active on this device (confirmed on server)."):(da?"Ikke bekræftet aktiv på denne enhed.":"Not confirmed active on this device.")}</p>}
   {error && <p role="alert">{error}</p>}
   <div className="row end">
     {onboarding && <button className="ghost" disabled={busy} onClick={()=>{setDismissed(true);void perform(()=>pushController.decline());}}>{da?"Ikke nu":"Not now"}</button>}
     <button disabled={busy||!supportedPush()} onClick={()=>void perform(()=>pushController.enable(state))}>{onboarding?(da?"Ja":"Yes"):(da?"Slå til / forny på denne enhed":"Enable / renew on this device")}</button>
     {!onboarding && <button className="ghost" disabled={busy} onClick={()=>void perform(()=>pushController.disable())}>{da?"Slå fra på denne enhed":"Disable on this device"}</button>}
   </div>
   {!onboarding && <><h4>{da?"Dine tilmeldte enheder":"Your registered devices"}</h4>
     <p className="meta">{da?"En tilmelding udløber efter 90 dage; forny ved at trykke ovenfor. Enheder er anonyme i denne liste.":"A registration expires after 90 days; renew using the button above. Devices are anonymous in this list."}</p>
     {state.devices.map((d,i)=><div className="row" key={d.id}><span>{da?"Enhed":"Device"} {i+1}</span><button className="ghost" disabled={busy} onClick={()=>void perform(()=>pushController.disable(d.id))}>{da?"Fjern":"Remove"}</button></div>)}
     <button className="ghost" disabled={busy} onClick={()=>void perform(()=>pushController.disable(null,true))}>{da?"Slå fra på alle enheder":"Disable on all devices"}</button>
   </>}
 </section>;
}

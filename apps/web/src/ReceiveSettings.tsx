import { useEffect, useRef, useState } from "react";
import { strings, type Lang } from "./i18n";
import { supabase } from "./supabase";
import { detectTimezone, searchTimezones, timezoneLabel } from "./timezones";
import { mergeWindows, windowIssues, type WindowIssue } from "./receiveWindows";
import { defaultReceiveWindows, invalidateReceiveTimezone, readReceiveSettings, saveReceiveSettings, syncReceiveTimezone, timezoneDevice, type ReceiveSettingsState, type ReceiveWindow } from "./receiveTimezone";
const toHM=(m:number)=>`${String(Math.floor(m/60)%24).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const steps=Array.from({length:96},(_,k)=>k*15);
function TimeSelect({label,value,set,end}:{label:string;value:number;set:(v:number)=>void;end?:boolean}) {
  const opts=[...new Set([...steps.filter(m=>!end||m>0),...(end?[1440]:[]),value])].sort((a,b)=>a-b);
  return <select aria-label={label} className="tsel" value={value} onChange={e=>set(+e.target.value)}>{opts.map(m=><option key={m} value={m}>{m===1440?"24:00":toHM(m)}</option>)}</select>;
}
const DA_DAYS=["mandag","tirsdag","onsdag","torsdag","fredag","lørdag","søndag"], EN_DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export function ReceiveSettings({lang}:{lang:Lang}) {
  const da=lang==="da", t=strings[lang];
  const [uid,setUid]=useState(""); const [base,setBase]=useState<ReceiveSettingsState|null>(null);
  const [enabled,setEnabled]=useState(false), [zone,setZone]=useState(""), [mode,setMode]=useState<"auto"|"fixed">("auto");
  const [windows,setWindows]=useState<ReceiveWindow[]>([]), [expanded,setExpanded]=useState(false), [query,setQuery]=useState("");
  const [takeOver,setTakeOver]=useState(false), [detected,setDetected]=useState<string|null>(detectTimezone);
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [conflict,setConflict]=useState(false);
  const [error,setError]=useState(""), [message,setMessage]=useState(""), [issues,setIssues]=useState<WindowIssue[]>([]), [nudge,setNudge]=useState(false);
  const mounted=useRef(true), saving=useRef(false);
  const adopt=(s:ReceiveSettingsState)=>{
    setBase(s);setEnabled(s.enabled);
    // Legacy/broken enabled+empty: show the editable default so Gem can repair it.
    setWindows(s.enabled && !s.windows.length ? defaultReceiveWindows() : s.windows);
    setMode(s.mode);setZone(s.timezone??detectTimezone()??"");setTakeOver(false);setConflict(false);setDetected(detectTimezone());
  };
  const load=async()=>{
    setLoading(true);setError("");setMessage("");
    try { const user=(await supabase.auth.getSession()).data.session?.user.id; if(!user) throw new Error("unauthenticated"); await syncReceiveTimezone(user); const s=await readReceiveSettings(user); if(mounted.current){setUid(user);adopt(s);} }
    catch { if(mounted.current) setError(da?"Modtagetiderne kunne ikke hentes. Prøv igen.":"Could not load receiving times. Please try again."); }
    finally { if(mounted.current)setLoading(false); }
  };
  useEffect(()=>{ mounted.current=true;void load();return()=>{mounted.current=false;}; },[]);
  const changed=()=>{setMessage("");setError("");setIssues([]);setNudge(false);};
  const controllerElsewhere=base?.mode==="auto" && !base.is_controller && !takeOver;
  const requiresDevice=mode==="auto" && !controllerElsewhere;
  const autoAvailable=!!detected && !!uid && !!timezoneDevice(uid);
  const needsWindow=enabled && !windows.length;
  const canSave=!busy&&!conflict&&!!zone&&!(requiresDevice&&!autoAvailable)&&!needsWindow;
  const save=async()=>{
    if(!base||saving.current||loading)return;
    // Gem stays tappable: an incomplete or overlapping schedule is explained instead of silently ignored.
    if(enabled&&needsWindow){setNudge(true);return;}
    const found=enabled?windowIssues(windows):[];
    if(found.length){setIssues(found);return;}
    if(!canSave)return;
    saving.current=true;setBusy(true);setMessage("");setError("");
    try {
      if((await supabase.auth.getSession()).data.session?.user.id!==uid)throw new Error("unauthenticated");
      // Gem saves the zone shown on screen right away; in "follow this device" mode that is the zone detected now.
      const timezone=mode==="auto"&&!controllerElsewhere&&detected?detected:zone;
      const result=await saveReceiveSettings(uid,base,{enabled,windows,mode,timezone,takeOver});
      invalidateReceiveTimezone(uid);
      if(mounted.current){adopt(result);setMessage(t.saved);setExpanded(false);setQuery("");}
    } catch(e) {
      if(mounted.current){const isConflict=/settings_conflict|timezone_control_required|timezone_not_controller/.test(String((e as {message?:string})?.message??e));setConflict(isConflict);setError(isConflict?(da?"Indstillingerne er ændret på en anden enhed. Hent dem igen, før du gemmer.":"Settings changed on another device. Reload them before saving."):(da?"Vi kunne ikke bekræfte, at modtagetiderne blev gemt. Prøv igen.":"We could not confirm that receiving times were saved. Please try again."));}
    } finally {saving.current=false;if(mounted.current)setBusy(false);}
  };
  const update=(i:number,p:Partial<ReceiveWindow>)=>{setWindows(windows.map((w,k)=>i===k?{...w,...p}:w));changed();};
  const toggleEnabled=(on:boolean)=>{
    setEnabled(on);
    if(on && !windows.length) setWindows(defaultReceiveWindows());
    changed();
  };
  const results=searchTimezones(query,zone,lang), choices=results.slice(0,80);
  if(loading)return <p role="status">{da?"Henter modtagetider…":"Loading receiving times…"}</p>;
  if(!base)return <><p className="err" role="alert">{error}</p><button type="button" onClick={()=>void load()}>{da?"Prøv igen":"Try again"}</button></>;
  return <div className="times">
    <fieldset className="receive-fields" disabled={busy}>
      <label className="switch"><input type="checkbox" checked={enabled} onChange={e=>toggleEnabled(e.target.checked)}/><span>{t.windowsOn}</span></label>
      <div className="timezone-summary"><div className="timezone-current"><span className="meta">{t.tz}</span><strong>{timezoneLabel(mode==="auto"&&!controllerElsewhere&&detected?detected:zone,lang)}</strong><span className="timezone-note">{mode==="fixed"?(da?"Fast tidszone. Tryk Skift for at følge telefonen.":"Fixed timezone. Tap Change to follow your phone."):controllerElsewhere?(da?"Følger tidszonen på din anden enhed.":"Follows the timezone on your other device."):(da?"Følger telefonens tidszone, også på rejser. Tryk Skift for at vælge selv.":"Follows your phone’s timezone, also when travelling. Tap Change to choose yourself.")}</span></div><button type="button" className="ghost compact-btn" aria-expanded={expanded} aria-controls="timezone-choices" onClick={()=>setExpanded(!expanded)}>{expanded?(da?"Luk valg":"Close choices"):(da?"Skift":"Change")}</button></div>
      {expanded && <fieldset id="timezone-choices" className="timezone-choices"><legend>{da?"Vælg tidszone":"Choose timezone"}</legend>
        <label className="switch"><input type="radio" name="timezone-mode" value="auto" checked={mode==="auto"} onChange={()=>{setMode("auto");setTakeOver(false);setZone(base.mode==="auto"&&!base.is_controller?(base.timezone??""):(detectTimezone()??""));setDetected(detectTimezone());changed();}}/><span>{da?"Følg denne enheds tidszone":"Follow this device’s timezone"}</span></label>
        <label className="switch"><input type="radio" name="timezone-mode" value="fixed" checked={mode==="fixed"} onChange={()=>{setMode("fixed");setTakeOver(false);changed();}}/><span>{da?"Brug en fast tidszone":"Use a fixed timezone"}</span></label>
        {mode==="fixed" && <><label htmlFor="timezone-search">{da?"Søg efter by eller land":"Search for city or country"}</label><input id="timezone-search" name="timezone-search" type="search" autoComplete="off" enterKeyHint="search" value={query} onChange={e=>setQuery(e.target.value)}/><label htmlFor="timezone-results">{da?"Tidszoner":"Timezones"}</label><select id="timezone-results" size={6} value={choices.includes(zone)?zone:""} onChange={e=>{if(e.target.value){setZone(e.target.value);changed();}}}><option value="">{da?"Vælg tidszone…":"Choose timezone…"}</option>{choices.map(z=><option key={z} value={z}>{timezoneLabel(z,lang)}</option>)}</select>{!results.length&&<p role="status">{da?"Ingen tidszoner fundet.":"No timezones found."}</p>}{results.length>80&&<p className="meta">{da?"Søg mere præcist for at se flere tidszoner.":"Refine your search to see more timezones."}</p>}</>}
        {mode==="auto" && controllerElsewhere && <div className="notice"><p>{da?"Modtagetiderne følger en anden enhed.":"Receiving times follow another device."}</p><button type="button" className="ghost" disabled={!autoAvailable} onClick={()=>{setTakeOver(true);setZone(detected??"");changed();}}>{da?"Brug denne enhed":"Use this device"}</button></div>}
        {mode==="auto"&&takeOver&&<p className="notice">{da?"Denne enhed vil fremover bestemme tidszonen for dine modtagetider. Tryk Gem for at bekræfte.":"This device will control your receiving timezone. Press Save to confirm."}</p>}
      </fieldset>}
      {requiresDevice&&!autoAvailable&&<p className="notice">{da?"Vi kunne ikke følge denne enheds tidszone. Vælg en fast tidszone under Skift.":"We could not follow this device’s timezone. Choose a fixed timezone under Change."}</p>}
      <div className="wlist">{windows.map((w,i)=><div className={issues.some(x=>x.kind==="same"?x.index===i:x.indexes.includes(i))?"wrow needs-attention":"wrow"} key={i}>
        <select aria-label={da?"Dag":"Day"} value={w.weekday} onChange={e=>update(i,{weekday:+e.target.value})}>{t.days.map((d,k)=><option key={k} value={k+1}>{d}</option>)}</select>
        <TimeSelect label={t.from} value={w.start_minute} set={v=>update(i,{start_minute:v})}/><span className="dash" aria-hidden="true">–</span><TimeSelect label={t.to} value={w.end_minute} set={v=>update(i,{end_minute:v})} end/>
        <button type="button" className="icon rm" aria-label={`${t.remove} ${t.days[w.weekday-1]} ${toHM(w.start_minute)}–${toHM(w.end_minute)}`} onClick={()=>{setWindows(windows.filter((_,k)=>i!==k));changed();}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
      </div>)}</div>
      {enabled&&windows.some(w=>w.end_minute<w.start_minute)&&<p className="meta wnote">{da?"Slutter et tidsrum før det starter, fortsætter det over midnat.":"A window that ends before it starts continues past midnight."}</p>}
      {issues.length>0&&<div className="field-hint-block" role="alert">{[...new Set(issues.map(x=>`${x.kind}:${x.weekday}`))].map(k=>{const [kind,d]=k.split(":");const day=(da?DA_DAYS:EN_DAYS)[+d-1];return <p key={k} className="field-hint">{kind==="overlap"?(da?`Tiderne overlapper for ${day}.`:`The times overlap on ${day}.`):(da?`Start og slut er ens for ${day}.`:`Start and end are the same on ${day}.`)}</p>;})}
        {issues.some(x=>x.kind==="overlap")&&!issues.some(x=>x.kind==="same")&&mergeWindows(windows)&&<button type="button" className="ghost compact-btn" onClick={()=>{const m=mergeWindows(windows);if(m){setWindows(m);setIssues([]);setMessage(da?"Tiderne er slået sammen. Tryk Gem for at gemme.":"The times were merged. Tap Save to save.");}}}>{da?"Slå sammen":"Merge"}</button>}</div>}
      {needsWindow&&<p className={nudge?"field-hint":"meta"} role={nudge?"alert":"status"}>{da?"Tilføj mindst ét tidsrum, eller slå modtagetider fra, før du gemmer.":"Add at least one time window, or turn receive times off, before saving."}</p>}
      <div className="times-actions"><button type="button" className="ghost" onClick={()=>{setWindows([...windows,{weekday:1,start_minute:17*60,end_minute:20*60}]);changed();}}>+ {da?"Tilføj tidsrum":"Add time"}</button><button type="button" className="times-save" disabled={busy} aria-disabled={!canSave||undefined} onClick={()=>void save()}>{busy?(da?"Gemmer…":"Saving…"):t.save}</button></div>
      {message&&<p className="meta times-saved" role="status">{message}</p>}
    </fieldset>
    {error&&<p className="err" role="alert">{error}</p>}{conflict&&<button type="button" className="ghost" onClick={()=>void load()}>{da?"Hent gemte indstillinger":"Reload saved settings"}</button>}
  </div>;
}

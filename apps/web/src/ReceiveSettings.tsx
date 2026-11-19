import { useEffect, useRef, useState } from "react";
import { strings, type Lang } from "./i18n";
import { supabase } from "./supabase";
import { detectTimezone, searchTimezones, timezoneLabel } from "./timezones";
import { daysToWindows, mergeWindows, windowIssues, windowsToDays, type DayState, type WindowIssue } from "./receiveWindows";
import { defaultReceiveWindows, invalidateReceiveTimezone, readReceiveSettings, saveReceiveSettings, syncReceiveTimezone, timezoneDevice, type ReceiveSettingsState, type ReceiveWindow } from "./receiveTimezone";
const toHM=(m:number)=>`${String(Math.floor(m/60)%24).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const steps=Array.from({length:96},(_,k)=>k*15);
function TimeSelect({label,value,set,end}:{label:string;value:number;set:(v:number)=>void;end?:boolean}) {
  const opts=[...new Set([...steps.filter(m=>!end||m>0),...(end?[1440]:[]),value])].sort((a,b)=>a-b);
  return <select aria-label={label} className="tsel" value={value} onChange={e=>set(+e.target.value)}>{opts.map(m=><option key={m} value={m}>{m===1440?"24:00":toHM(m)}</option>)}</select>;
}
const DA_DAYS=["mandag","tirsdag","onsdag","torsdag","fredag","lørdag","søndag"], EN_DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
function nextRange(ranges:{start_minute:number;end_minute:number}[]) {
  const last=ranges[ranges.length-1];
  // Leave a one-hour gap so the new range is not immediately merged as adjacent.
  const start=last && last.end_minute>last.start_minute ? last.end_minute+60 : 20*60;
  const end=Math.min(start+60, 1440);
  if (end<=start || start>1439) return { start_minute: 8*60, end_minute: 9*60 };
  return { start_minute: Math.min(start, 22*60), end_minute: Math.min(start, 22*60)+60 };
}

export function ReceiveSettings({lang,conv,onCancel}:{lang:Lang;conv:string;onCancel?:()=>void}) {
  const da=lang==="da", t=strings[lang];
  const [uid,setUid]=useState(""); const [base,setBase]=useState<ReceiveSettingsState|null>(null);
  const [enabled,setEnabled]=useState(false), [zone,setZone]=useState(""), [mode,setMode]=useState<"auto"|"fixed">("auto");
  const [days,setDays]=useState<DayState[]>(windowsToDays([])), [expanded,setExpanded]=useState(false), [query,setQuery]=useState("");
  const [takeOver,setTakeOver]=useState(false), [detected,setDetected]=useState<string|null>(detectTimezone);
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [conflict,setConflict]=useState(false);
  const [error,setError]=useState(""), [message,setMessage]=useState(""), [issues,setIssues]=useState<WindowIssue[]>([]), [nudge,setNudge]=useState(false);
  const mounted=useRef(true), saving=useRef(false);
  const windowsFromDays=()=>daysToWindows(days);
  const adopt=(s:ReceiveSettingsState)=>{
    setBase(s);setEnabled(s.enabled);
    const raw=s.enabled && !s.windows.length ? defaultReceiveWindows() : s.windows;
    setDays(windowsToDays(raw));
    setMode(s.mode);setZone(s.timezone??detectTimezone()??"");setTakeOver(false);setConflict(false);setDetected(detectTimezone());
  };
  const load=async()=>{
    setLoading(true);setError("");setMessage("");
    try { const user=(await supabase.auth.getSession()).data.session?.user.id; if(!user) throw new Error("unauthenticated"); await syncReceiveTimezone(user,true,conv); const s=await readReceiveSettings(user,conv); if(mounted.current){setUid(user);adopt(s);} }
    catch { if(mounted.current) setError(da?"Modtagetiderne kunne ikke hentes. Prøv igen.":"Could not load receiving times. Please try again."); }
    finally { if(mounted.current)setLoading(false); }
  };
  useEffect(()=>{ mounted.current=true;void load();return()=>{mounted.current=false;}; },[conv]);
  const changed=()=>{setMessage("");setError("");setIssues([]);setNudge(false);};
  const controllerElsewhere=base?.mode==="auto" && !base.is_controller && !takeOver;
  const requiresDevice=mode==="auto" && !controllerElsewhere;
  const autoAvailable=!!detected && !!uid && !!timezoneDevice(uid);
  const windows=windowsFromDays();
  const needsWindow=enabled && !windows.length;
  const canSave=!busy&&!conflict&&!!zone&&!(requiresDevice&&!autoAvailable)&&!needsWindow;
  const save=async()=>{
    if(!base||saving.current||loading)return;
    if(enabled&&needsWindow){setNudge(true);return;}
    const found=enabled?windowIssues(windows).filter(x=>x.kind==="same"):[];
    if(found.length){setIssues(found);return;}
    let toSave:ReceiveWindow[]=windows;
    if(enabled && windows.length){
      const merged=mergeWindows(windows);
      if(!merged){setIssues(windowIssues(windows).filter(x=>x.kind==="overlap"));setError(da?"Tiderne kunne ikke slås sammen. Ret overlap, der er længere end et døgn.":"The times could not be merged. Fix any overlap longer than 24 hours.");return;}
      toSave=merged;
      if(merged!==windows) setDays(windowsToDays(merged));
    }
    if(!canSave)return;
    saving.current=true;setBusy(true);setMessage("");setError("");
    try {
      if((await supabase.auth.getSession()).data.session?.user.id!==uid)throw new Error("unauthenticated");
      const timezone=mode==="auto"&&!controllerElsewhere&&detected?detected:zone;
      const result=await saveReceiveSettings(uid,conv,base,{enabled,windows:toSave,mode,timezone,takeOver});
      invalidateReceiveTimezone(uid);
      if(mounted.current){adopt(result);setMessage(t.saved);setExpanded(false);setQuery("");}
    } catch(e) {
      if(mounted.current){const isConflict=/settings_conflict|timezone_control_required|timezone_not_controller/.test(String((e as {message?:string})?.message??e));setConflict(isConflict);setError(isConflict?(da?"Indstillingerne er ændret på en anden enhed. Hent dem igen, før du gemmer.":"Settings changed on another device. Reload them before saving."):(da?"Vi kunne ikke bekræfte, at modtagetiderne blev gemt. Prøv igen.":"We could not confirm that receiving times were saved. Please try again."));}
    } finally {saving.current=false;if(mounted.current)setBusy(false);}
  };
  const setDay=(weekday:number,patch:Partial<DayState>|((d:DayState)=>DayState))=>{
    setDays(days.map(d=>d.weekday!==weekday?d:typeof patch==="function"?patch(d):{...d,...patch}));
    changed();
  };
  const toggleEnabled=(on:boolean)=>{
    setEnabled(on);
    if(on && !days.some(d=>d.on)) setDays(windowsToDays(defaultReceiveWindows()));
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
      {enabled && <div className="daylist" role="list">
        {days.map(day=>{
          const dayName=t.days[day.weekday-1];
          const full=(da?DA_DAYS:EN_DAYS)[day.weekday-1];
          const flagged=issues.some(x=>x.kind==="same"?windows[x.index]?.weekday===day.weekday:x.weekday===day.weekday);
          return <div className={"dayrow"+(flagged?" needs-attention":"")} role="listitem" key={day.weekday}>
            <div className="dayrow-main">
              <span className="day-label">{dayName}</span>
              <button type="button" role="switch" className="toggle-switch" aria-checked={day.on} aria-label={da?`Modtag beskeder ${full}`:`Receive messages on ${full}`} onClick={()=>setDay(day.weekday,{on:!day.on,ranges:day.ranges.length?day.ranges:[{start_minute:18*60,end_minute:19*60}]}) }><span className="switch-knob" aria-hidden="true"/></button>
              {day.on ? <div className="day-ranges">
                {day.ranges.map((r,i)=><div className="wrow" key={i}>
                  <TimeSelect label={`${t.from} ${full}${day.ranges.length>1?` ${i+1}`:""}`} value={r.start_minute} set={v=>setDay(day.weekday,d=>({...d,ranges:d.ranges.map((x,k)=>k===i?{...x,start_minute:v}:x)}))}/>
                  <span className="dash" aria-hidden="true">–</span>
                  <TimeSelect label={`${t.to} ${full}${day.ranges.length>1?` ${i+1}`:""}`} value={r.end_minute} set={v=>setDay(day.weekday,d=>({...d,ranges:d.ranges.map((x,k)=>k===i?{...x,end_minute:v}:x)}))} end/>
                  {i>0 && <button type="button" className="icon rm" aria-label={`${t.remove} ${full} ${toHM(r.start_minute)}–${toHM(r.end_minute===1440?0:r.end_minute)}`} onClick={()=>setDay(day.weekday,d=>({...d,ranges:d.ranges.filter((_,k)=>k!==i)}))}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>}
                </div>)}
              </div> : <span className="day-closed">{da?"Ingen beskeder":"No messages"}</span>}
            </div>
            <div className="dayrow-actions">
              {day.on && <button type="button" className="icon day-add" aria-label={da?`Tilføj tidsrum på ${full}`:`Add time on ${full}`} onClick={()=>setDay(day.weekday,d=>({...d,ranges:[...d.ranges,nextRange(d.ranges)]}))}>+</button>}
              <button type="button" className="icon day-copy" aria-label={da?`Kopiér ${full} til alle dage`:`Copy ${full} to all days`} title={da?"Kopiér til alle dage":"Copy to all days"} onClick={()=>{const src=days.find(d=>d.weekday===day.weekday)!; setDays(days.map(d=>d.weekday===src.weekday?d:{weekday:d.weekday,on:src.on,ranges:src.ranges.map(r=>({...r}))})); changed(); setMessage(da?`Tiderne fra ${full} er kopieret til alle dage. Tryk Gem for at gemme.`:`Times from ${full} were copied to all days. Tap Save to save.`);}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg></button>
            </div>
          </div>;
        })}
      </div>}
      {enabled&&days.some(d=>d.on&&d.ranges.some(r=>r.end_minute<r.start_minute))&&<p className="meta wnote">{da?"Slutter et tidsrum før det starter, fortsætter det over midnat.":"A window that ends before it starts continues past midnight."}</p>}
      {issues.length>0&&<div className="field-hint-block" role="alert">{[...new Set(issues.map(x=>`${x.kind}:${x.weekday}`))].map(k=>{const [kind,d]=k.split(":");const day=(da?DA_DAYS:EN_DAYS)[+d-1];return <p key={k} className="field-hint">{kind==="overlap"?(da?`Tiderne overlapper for ${day}.`:`The times overlap on ${day}.`):(da?`Start og slut er ens for ${day}.`:`Start and end are the same on ${day}.`)}</p>;})}</div>}
      {needsWindow&&<p className={nudge?"field-hint":"meta"} role={nudge?"alert":"status"}>{da?"Tilføj mindst ét tidsrum, eller slå modtagetider fra, før du gemmer.":"Add at least one time window, or turn receive times off, before saving."}</p>}
      <div className="times-actions sheet-actions">
        <button type="button" className="ghost" onClick={()=>onCancel?onCancel():void load()}>{da?"Annuller":"Cancel"}</button>
        <button type="button" className="times-save" disabled={busy} aria-disabled={!canSave||undefined} onClick={()=>void save()}>{busy?(da?"Gemmer…":"Saving…"):t.save}</button>
      </div>
      {message&&<p className="meta times-saved" role="status">{message}</p>}
    </fieldset>
    {error&&<p className="err" role="alert">{error}</p>}{conflict&&<button type="button" className="ghost" onClick={()=>void load()}>{da?"Hent gemte indstillinger":"Reload saved settings"}</button>}
  </div>;
}

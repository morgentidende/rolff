import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useBackLayer } from "./backNavigation";
import { blockingApi, sortBlockEntries, type BlockEntry, type BlockSort } from "./blockingListModel";
import type { Lang } from "./i18n";

function Modal({ title, close, children }: { title: string; close: ()=>void; children: ReactNode }) {
 const ref=useRef<HTMLDialogElement>(null);
 useBackLayer(true,close);
 useEffect(()=>{ const before=document.activeElement as HTMLElement|null; const d=ref.current;d?.showModal();return ()=>{d?.close();if(before?.isConnected)before.focus();};},[]);
 return <dialog className="blocking-dialog" ref={ref} aria-labelledby="blocking-dialog-title" onCancel={e=>{e.preventDefault();close();}}><h2 id="blocking-dialog-title">{title}</h2>{children}</dialog>;
}
export function InfoButton({ label, open }: { label: string; open: ()=>void }) {
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null), start=useRef<{x:number;y:number}|null>(null), suppress=useRef(false);
 const clear=()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;};
 const cancel=()=>{if(start.current)suppress.current=true;start.current=null;clear();};
 useEffect(()=>{document.addEventListener("scroll",cancel,true);window.addEventListener("blur",cancel);return ()=>{clear();document.removeEventListener("scroll",cancel,true);window.removeEventListener("blur",cancel);};},[]);
 return <button type="button" className="blocking-info" aria-label={label} onPointerDown={e=>{if(!e.isPrimary||e.button!==0)return;clear();suppress.current=false;start.current={x:e.clientX,y:e.clientY};timer.current=setTimeout(()=>{suppress.current=true;clear();open();},500);}}
 onPointerMove={e=>{if(start.current&&Math.hypot(e.clientX-start.current.x,e.clientY-start.current.y)>10)cancel();}} onPointerUp={()=>{clear();start.current=null;}} onPointerLeave={cancel} onPointerCancel={cancel}
 onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")suppress.current=false;}} onClick={e=>{if(suppress.current){suppress.current=false;e.preventDefault();return;}open();}}><span aria-hidden="true">ⓘ</span></button>;
}
const Trash=()=> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>;
export function BlockingLists({ lang, conv, session }: { lang: Lang; conv: string; session: Session }) {
 const da=lang==="da", [words,setWords]=useState<BlockEntry[]>([]),[topics,setTopics]=useState<BlockEntry[]>([]);
 const [word,setWord]=useState(""),[topic,setTopic]=useState(""),[ack,setAck]=useState(false),[sort,setSort]=useState<BlockSort>("oldest");
 const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(true),[err,setErr]=useState(""),[modal,setModal]=useState<"words"|"topics"|"reset"|null>(null);
 const generation=useRef(0),inflight=useRef(false);
 const api=blockingApi(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,session.access_token);
 const query=(table:string)=>`${table}?select=id,word,created_at&conversation_id=eq.${encodeURIComponent(conv)}&user_id=eq.${session.user.id}&order=created_at.asc,id.asc`;
 const error=da?"Ændringen kunne ikke bekræftes. Listen og din tekst er bevaret. Prøv igen.":"The change could not be confirmed. Your list and draft are preserved. Please retry.";
 useEffect(()=>{
  const g=++generation.current, ac=new AbortController();setLoaded(false);setLoading(true);setErr("");setBusy(false);inflight.current=false;
  Promise.all([api(query("conversation_blocked_words"),"GET",undefined,ac.signal),api(query("conversation_blocked_topics"),"GET",undefined,ac.signal)]).then(([w,t])=>{if(g===generation.current){setWords(w);setTopics(t);setLoaded(true);}}).catch(()=>{if(g===generation.current)setErr(da?"Listerne kunne ikke hentes. Luk og prøv igen.":"Could not load lists. Close and retry.");}).finally(()=>{if(g===generation.current)setLoading(false);});
  return ()=>{generation.current++;ac.abort();};
 },[conv,session.user.id,session.access_token]);
 const change=async(path:string,method:string,body:unknown,success:(result:any)=>void|Promise<void>)=>{
  if(inflight.current||!loaded)return;inflight.current=true;setBusy(true);setErr("");const g=generation.current;
  try {const result=await api(path,method,body);if(g===generation.current)await success(result);}
  catch {if(g===generation.current)setErr(error);}
  finally {if(g===generation.current){inflight.current=false;setBusy(false);}}
 };
 const remove=(entry:BlockEntry,isTopic:boolean)=>change(`rpc/remove_blocked_${isTopic?"topic":"word"}`,"POST",{conv,p_id:entry.id},()=>isTopic?setTopics(x=>x.filter(i=>i.id!==entry.id)):setWords(x=>x.filter(i=>i.id!==entry.id)));
 const add=async(isTopic:boolean)=>{
  const value=(isTopic?topic:word).trim();
  await change(`rpc/${isTopic?"add_blocked_topic":"add_blocked_word"}`,"POST",{conv,p_word:value,...(isTopic?{}:{p_ack:ack})},async()=>{
   // Fetch real server creation timestamps; never fabricate chronology.
   await reloadAfterSave(isTopic);
  });
 };
 const reloadAfterSave=async(isTopic:boolean)=>{
  const g=generation.current;
  const rows=await api(query(isTopic?"conversation_blocked_topics":"conversation_blocked_words"));if(g===generation.current){if(isTopic){setTopics(rows);setTopic("");}else{setWords(rows);setWord("");setAck(false);}}
 };
 const infoWords=da?"Ord, udtryk og hele sætninger matches som tekst; store/små bogstaver og accenter ignoreres. Kun du ser din liste. Ved et match får afsenderen dog selve det ramte ord/udtryk at se. Sortering ændrer ikke din liste. Nulstilling fjerner kun blokerede ord, ikke emner.":"Words, expressions and sentences are matched as text, ignoring case and accents. Only you see your list, but senders see the matched word/phrase. Sorting changes only the view. Reset removes words, not topics.";
 const infoTopics=da?"Blokér efter betydning, også venlig eller neutral omtale. Skriv fx ‘omtaler mine forældre’ eller ‘omtaler mit udseende’. ‘Mine’ og ‘mit’ betyder dig som modtager. AI kan tage fejl; ved usikker betydning beder vi om præcisering. Ingen send-alligevel. Listen er privat og vises ikke til afsenderen. Dine emner sendes til AI-tjenesten sammen med beskeden; der er endnu ingen garanti om EU-behandling eller Zero Data Retention.":"Block by meaning, including friendly or neutral mentions. Try ‘mentions my parents’ or ‘mentions my appearance’. ‘My’ means you as recipient. AI can make mistakes; uncertain meaning requires clarification, with no send-anyway option. The sender does not see your criteria. Criteria are sent to the AI service with the message; EU processing and Zero Data Retention are not yet guaranteed.";
 const renderList=(items:BlockEntry[],isTopic:boolean)=><ul className="words blocking-entries">{sortBlockEntries(items,sort,lang).map(x=><li key={x.id}><span>{x.word}</span><button className="ghost blocking-trash" type="button" disabled={busy||!loaded} aria-label={`${da?"Fjern":"Remove"} ${x.word}`} onClick={()=>void remove(x,isTopic)}><Trash/></button></li>)}</ul>;
 return <div className="blocking-lists" aria-busy={busy}>
 <section><div className="blocking-heading"><h3>{da?"Blokerede ord":"Blocked words"}</h3><InfoButton label={da?"Om blokerede ord":"About blocked words"} open={()=>setModal("words")}/></div>
 <label>{da?"Rækkefølge":"Order"}<select value={sort} onChange={e=>setSort(e.target.value as BlockSort)}><option value="alphabetical">{da?"Alfabetisk":"Alphabetical"}</option><option value="newest">{da?"Nyest først":"Newest first"}</option><option value="oldest">{da?"Ældste først":"Oldest first"}</option></select></label>
 {loading?<p role="status">{da?"Henter lister…":"Loading lists…"}</p>:!loaded?null:words.length?renderList(words,false):<p className="meta">{da?"Ingen blokerede ord.":"No blocked words."}</p>}
 <button className="ghost" type="button" disabled={!loaded||busy||!words.length} onClick={()=>setModal("reset")}>{da?"Nulstil blokeringsliste":"Reset blocked words"}</button>
 <form onSubmit={e=>{e.preventDefault();void add(false);}}><label htmlFor="blocked-word">{da?"Tilføj ord, udtryk eller sætning":"Add word, phrase or sentence"}</label><input id="blocked-word" maxLength={120} value={word} disabled={busy} onChange={e=>{setWord(e.target.value);setAck(false);}}/>
 <label className="blocking-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy}/>{da?"Jeg forstår, at afsenderen får det ramte ord/udtryk at se.":"I understand the sender sees the matched word/phrase."}</label><button disabled={!loaded||busy||!ack||[...word.trim()].length<2}>{da?"Tilføj":"Add"}</button></form></section>
 <section><div className="blocking-heading"><h3>{da?"Blokerede emner":"Blocked topics"}</h3><InfoButton label={da?"Om blokerede emner":"About blocked topics"} open={()=>setModal("topics")}/></div>
 <p className="meta">{da?"Din private liste efter betydning – også neutral omtale. Emnerne sendes til AI-tjenesten ved tjek.":"Your private meaning-based list, including neutral mentions. Criteria are sent to the AI service for checking."}</p>
 {loaded&&(topics.length?renderList(topics,true):<p className="meta">{da?"Ingen blokerede emner.":"No blocked topics."}</p>)}
 <form onSubmit={e=>{e.preventDefault();void add(true);}}><label htmlFor="blocked-topic">{da?"Blokér beskeder, der …":"Block messages that …"}</label><input id="blocked-topic" maxLength={240} value={topic} disabled={busy} placeholder={da?"omtaler mine forældre":"mention my parents"} onChange={e=>setTopic(e.target.value)}/><p className="meta">{da?"Fx omtaler mine forældre / omtaler mit udseende. Højst 20 emner, 2–240 tegn hver. AI kan tage fejl.":"E.g. mention my parents / mention my appearance. Up to 20 topics, 2–240 characters each. AI can make mistakes."}</p><button disabled={!loaded||busy||[...topic.trim()].length<2}>{da?"Tilføj emne":"Add topic"}</button></form></section>
 {err&&<p role="alert" className="err">{err}</p>}
 {modal&&<Modal title={modal==="reset"?(da?"Nulstil blokeringsliste?":"Reset blocked words?"):(modal==="words"?(da?"Blokerede ord":"Blocked words"):(da?"Blokerede emner":"Blocked topics"))} close={()=>setModal(null)}>
 {modal==="reset"?<><p>{da?"Alle dine blokerede ord i denne samtale fjernes. Dine blokerede emner bevares.":"All your blocked words in this conversation will be removed. Your blocked topics are kept."}</p><div className="row end"><button type="button" className="ghost" onClick={()=>setModal(null)}>{da?"Annuller":"Cancel"}</button><button type="button" disabled={busy} onClick={()=>{setModal(null);void change("rpc/reset_blocked_words","POST",{conv},()=>setWords([]));}}>{da?"Nulstil":"Reset"}</button></div></>:<><p>{modal==="words"?infoWords:infoTopics}</p><button type="button" onClick={()=>setModal(null)}>{da?"Luk":"Close"}</button></>}
 </Modal>}
 </div>;
}

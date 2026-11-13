import { useEffect, useRef, useState, type ReactNode } from "react";
import { focusField } from "./formHint";
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
 const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(true),[err,setErr]=useState(""),[modal,setModal]=useState<"words"|"topics"|"attachments"|"reset"|null>(null);
 const [blockPhotos,setBlockPhotos]=useState(false),[blockFiles,setBlockFiles]=useState(false);
 const [wordHint,setWordHint]=useState<""|"short"|"ack">(""),[topicHint,setTopicHint]=useState(false);
 const generation=useRef(0),inflight=useRef(false),wordRef=useRef<HTMLInputElement>(null),topicRef=useRef<HTMLInputElement>(null),ackRef=useRef<HTMLInputElement>(null);
 const api=blockingApi(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,session.access_token);
 const query=(table:string)=>`${table}?select=id,word,created_at&conversation_id=eq.${encodeURIComponent(conv)}&user_id=eq.${session.user.id}&order=created_at.asc,id.asc`;
 const error=da?"Ændringen kunne ikke bekræftes. Listen og din tekst er bevaret. Prøv igen.":"The change could not be confirmed. Your list and draft are preserved. Please retry.";
 useEffect(()=>{
  const g=++generation.current, ac=new AbortController();setLoaded(false);setLoading(true);setErr("");setBusy(false);inflight.current=false;
  Promise.all([api(query("conversation_blocked_words"),"GET",undefined,ac.signal),api(query("conversation_blocked_topics"),"GET",undefined,ac.signal),api("rpc/get_my_attachment_blocks","POST",{conv},ac.signal)]).then(([w,t,a])=>{if(g===generation.current){setWords(w);setTopics(t);setBlockPhotos(a?.block_photos===true);setBlockFiles(a?.block_files===true);setLoaded(true);}}).catch(()=>{if(g===generation.current)setErr(da?"Listerne kunne ikke hentes. Luk og prøv igen.":"Could not load lists. Close and retry.");}).finally(()=>{if(g===generation.current)setLoading(false);});
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
  // The add buttons stay tappable: a tap (or Enter) on an incomplete form explains what is missing.
  if(isTopic){if([...value].length<2){setTopicHint(true);focusField(topicRef.current);return;}}
  else if([...value].length<2){setWordHint("short");focusField(wordRef.current);return;}
  else if(!ack){setWordHint("ack");focusField(ackRef.current);return;}
  await change(`rpc/${isTopic?"add_blocked_topic":"add_blocked_word"}`,"POST",{conv,p_word:value,...(isTopic?{}:{p_ack:ack})},async()=>{
   // Fetch real server creation timestamps; never fabricate chronology.
   await reloadAfterSave(isTopic);
  });
 };
 const reloadAfterSave=async(isTopic:boolean)=>{
  const g=generation.current;
  const rows=await api(query(isTopic?"conversation_blocked_topics":"conversation_blocked_words"));if(g===generation.current){if(isTopic){setTopics(rows);setTopic("");topicRef.current?.focus({preventScroll:true});}else{setWords(rows);setWord("");setAck(false);wordRef.current?.focus({preventScroll:true});}}
 };
 const infoWords=da?"Ord, udtryk og hele sætninger matches som tekst; store/små bogstaver og accenter ignoreres. Kun du ser din liste. Ved et match får afsenderen dog selve det ramte ord/udtryk at se. Sortering ændrer ikke din liste. Nulstilling fjerner kun blokerede ord, ikke emner.":"Words, expressions and sentences are matched as text, ignoring case and accents. Only you see your list, but senders see the matched word/phrase. Sorting changes only the view. Reset removes words, not topics.";
 const setAttach=(photos:boolean,files:boolean)=>change("rpc/set_my_attachment_blocks","POST",{conv,p_block_photos:photos,p_block_files:files},result=>{setBlockPhotos(result?.block_photos===true);setBlockFiles(result?.block_files===true);});
 const infoAttachments=da?"Blokér fotos eller filer (PDF), som den anden sender i denne samtale. Indstillingen gælder kun her, er slået fra som standard, og kun du ser den. Afsenderen får at vide, at du ikke tager imod den type – ikke om beskeder er læst eller modtaget. Allerede sendte vedhæftninger bliver stående.":"Block photos or files (PDF) the other person sends in this conversation. The setting applies only here, is off by default, and only you see it. The sender is told that you do not accept that type — not whether messages were read or delivered. Attachments already sent stay in the conversation.";
 const infoTopics=da?"Blokér efter betydning, også venlig eller neutral omtale. Skriv fx ‘omtaler mine forældre’ eller ‘omtaler mit udseende’. ‘Mine’ og ‘mit’ betyder dig som modtager. AI kan tage fejl; ved usikker betydning beder vi om præcisering. Ingen send-alligevel. Listen er privat og vises ikke til afsenderen. Dine emner sendes til AI-tjenesten sammen med beskeden; der er endnu ingen garanti om EU-behandling eller Zero Data Retention.":"Block by meaning, including friendly or neutral mentions. Try ‘mentions my parents’ or ‘mentions my appearance’. ‘My’ means you as recipient. AI can make mistakes; uncertain meaning requires clarification, with no send-anyway option. The sender does not see your criteria. Criteria are sent to the AI service with the message; EU processing and Zero Data Retention are not yet guaranteed.";
 const renderList=(items:BlockEntry[],isTopic:boolean)=><ul className="blocking-entries">{sortBlockEntries(items,isTopic?"oldest":sort,lang).map(x=><li key={x.id}><span>{x.word}</span><button className="blocking-trash" type="button" disabled={busy||!loaded} aria-label={`${da?"Fjern":"Remove"} ${x.word}`} onClick={()=>void remove(x,isTopic)}><Trash/></button></li>)}</ul>;
 const wordMissing=!loaded||[...word.trim()].length<2||!ack, topicMissing=!loaded||[...topic.trim()].length<2;
 const ackText=da?"Jeg forstår, at afsenderen får det ramte ord at se.":"I understand the sender will see the matched word.";
 return <div className="blocking-lists" aria-busy={busy}>
 <section className="blocking-card" aria-labelledby="blocked-words-title"><div className="blocking-heading"><h3 id="blocked-words-title">{da?"Blokerede ord":"Blocked words"}</h3><InfoButton label={da?"Om blokerede ord":"About blocked words"} open={()=>setModal("words")}/>
 {loaded&&words.length>1&&<label className="blocking-sort"><span className="sr-only">{da?"Rækkefølge":"Order"}</span><select value={sort} onChange={e=>setSort(e.target.value as BlockSort)}><option value="alphabetical">{da?"A–Å":"A–Z"}</option><option value="newest">{da?"Nyeste":"Newest"}</option><option value="oldest">{da?"Ældste":"Oldest"}</option></select></label>}</div>
 <p className="meta blocking-lead">{da?"Beskeder med disse ord når ikke frem til dig. Kun du ser listen.":"Messages with these words do not reach you. Only you see the list."}</p>
 {loading?<p role="status" className="meta">{da?"Henter lister…":"Loading lists…"}</p>:!loaded?null:words.length?renderList(words,false):<p className="blocking-empty">{da?"Ingen blokerede ord endnu.":"No blocked words yet."}</p>}
 <form className="blocking-add" noValidate onSubmit={e=>{e.preventDefault();void add(false);}}><label htmlFor="blocked-word">{da?"Tilføj ord eller udtryk":"Add a word or phrase"}</label>
 <div className="blocking-add-row"><input id="blocked-word" ref={wordRef} name="blocked-word" maxLength={120} value={word} disabled={busy} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" aria-invalid={wordHint==="short"||undefined} aria-describedby={wordHint==="short"?"blocked-word-hint":undefined} onChange={e=>{setWord(e.target.value);if(wordHint==="short")setWordHint("");}}/>
 <button type="submit" aria-disabled={wordMissing||undefined} disabled={busy}>{da?"Tilføj":"Add"}</button></div>
 {wordHint==="short"&&<p id="blocked-word-hint" className="field-hint" role="alert">{da?"Skriv mindst 2 tegn.":"Type at least 2 characters."}</p>}
 <label className={`check-row blocking-ack${wordHint==="ack"?" needs-attention":""}`}><input type="checkbox" className="check" ref={ackRef} checked={ack} disabled={busy} aria-invalid={wordHint==="ack"||undefined} aria-describedby={wordHint==="ack"?"blocked-ack-hint":undefined} onChange={e=>{setAck(e.target.checked);if(e.target.checked&&wordHint==="ack")setWordHint("");}}/><span>{ackText}</span></label>
 {wordHint==="ack"&&<p id="blocked-ack-hint" className="field-hint" role="alert">{da?"Sæt flueben i ”Jeg forstår …” for at tilføje.":"Tick “I understand …” to add."}</p>}
 </form>
 {loaded&&words.length>0&&<div className="blocking-foot"><button className="text-danger" type="button" disabled={busy} onClick={()=>setModal("reset")}>{da?"Nulstil blokeringsliste":"Reset blocked words"}</button></div>}
 </section>
 <section className="blocking-card" aria-labelledby="blocked-topics-title"><div className="blocking-heading"><h3 id="blocked-topics-title">{da?"Blokerede emner":"Blocked topics"}</h3><InfoButton label={da?"Om blokerede emner":"About blocked topics"} open={()=>setModal("topics")}/></div>
 <p className="meta blocking-lead">{da?"Blokér beskeder ud fra, hvad de handler om. Kun du ser listen.":"Block messages by what they are about. Only you see the list."}</p>
 {loaded&&(topics.length?renderList(topics,true):<p className="blocking-empty">{da?"Ingen emner endnu. Prøv fx ”omtaler mit udseende”.":"No topics yet. Try e.g. “mentions my appearance”."}</p>)}
 <form className="blocking-add" noValidate onSubmit={e=>{e.preventDefault();void add(true);}}><label htmlFor="blocked-topic">{da?"Blokér beskeder, der …":"Block messages that …"}</label>
 <div className="blocking-add-row"><input id="blocked-topic" ref={topicRef} name="blocked-topic" maxLength={240} value={topic} disabled={busy} autoComplete="off" autoCapitalize="none" enterKeyHint="done" placeholder={da?"omtaler mine forældre":"mention my parents"} aria-invalid={topicHint||undefined} aria-describedby={topicHint?"blocked-topic-hint blocked-topic-help":"blocked-topic-help"} onChange={e=>{setTopic(e.target.value);setTopicHint(false);}}/>
 <button type="submit" aria-disabled={topicMissing||undefined} disabled={busy}>{da?"Tilføj emne":"Add topic"}</button></div>
 {topicHint&&<p id="blocked-topic-hint" className="field-hint" role="alert">{da?"Skriv mindst 2 tegn for at tilføje et emne.":"Type at least 2 characters to add a topic."}</p>}
 <p id="blocked-topic-help" className="meta blocking-help">{da?"Højst 20 emner. Emnerne tjekkes af AI, som kan tage fejl.":"Up to 20 topics. Topics are checked by AI, which can make mistakes."}</p></form>
 </section>
 <section className="blocking-card" aria-labelledby="blocked-attachments-title"><div className="blocking-heading"><h3 id="blocked-attachments-title">{da?"Vedhæftninger":"Attachments"}</h3><InfoButton label={da?"Om blokerede vedhæftninger":"About blocked attachments"} open={()=>setModal("attachments")}/></div>
 <p className="meta blocking-lead">{da?"Blokér fotos eller filer, som den anden sender i denne samtale. Kun du ser indstillingen.":"Block photos or files the other person sends in this conversation. Only you see this setting."}</p>
 {loaded&&<div className="blocking-toggles">
  <div className="setting-row"><div className="setting-text"><span className="setting-title" id="block-photos-label">{da?"Blokér fotos":"Block photos"}</span></div>
   <button type="button" role="switch" className="toggle-switch" aria-checked={blockPhotos} aria-labelledby="block-photos-label" disabled={busy||!loaded} onClick={()=>void setAttach(!blockPhotos,blockFiles)}><span className="switch-knob" aria-hidden="true"/></button></div>
  <div className="setting-row"><div className="setting-text"><span className="setting-title" id="block-files-label">{da?"Blokér filer (PDF)":"Block files (PDF)"}</span></div>
   <button type="button" role="switch" className="toggle-switch" aria-checked={blockFiles} aria-labelledby="block-files-label" disabled={busy||!loaded} onClick={()=>void setAttach(blockPhotos,!blockFiles)}><span className="switch-knob" aria-hidden="true"/></button></div>
 </div>}
 </section>
 {err&&<p role="alert" className="err">{err}</p>}
 {modal&&<Modal title={modal==="reset"?(da?"Nulstil blokeringsliste?":"Reset blocked words?"):(modal==="words"?(da?"Blokerede ord":"Blocked words"):modal==="topics"?(da?"Blokerede emner":"Blocked topics"):(da?"Vedhæftninger":"Attachments"))} close={()=>setModal(null)}>
 {modal==="reset"?<><p>{da?"Alle dine blokerede ord i denne samtale fjernes. Dine blokerede emner og vedhæftningsindstillinger bevares.":"All your blocked words in this conversation will be removed. Your blocked topics and attachment settings are kept."}</p><div className="row end"><button type="button" className="ghost" onClick={()=>setModal(null)}>{da?"Annuller":"Cancel"}</button><button type="button" className="danger" disabled={busy} onClick={()=>{setModal(null);void change("rpc/reset_blocked_words","POST",{conv},()=>setWords([]));}}>{da?"Nulstil":"Reset"}</button></div></>:<><p>{modal==="words"?infoWords:modal==="topics"?infoTopics:infoAttachments}</p><button type="button" onClick={()=>setModal(null)}>{da?"Luk":"Close"}</button></>}
 </Modal>}
 </div>;
}

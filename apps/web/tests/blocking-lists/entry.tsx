import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockingLists } from "../../src/BlockingLists";
import { useBackNavigationRoot } from "../../src/backNavigation";
import { blockedAttachmentNotice } from "../../src/attachmentBlocks";
import type { Lang } from "../../src/i18n";
const w=window as any;
const make=(id:string,word:string,time:string)=>({id,word,created_at:time});
const original=[make("1","åben aftale","2026-01-02T10:00:00+00:00"),make("2","æble","2026-01-01T10:00:00+00:00"),make("3","ønske","2026-01-02T10:00:00+00:00")];
let words=[...original],topics=[make("4","omtaler mine forældre","2026-01-01T10:00:00+00:00")];
let attach={photos:false,files:false};
w.QA={requests:[],fail:false,pause:false,pending:[],attach,changeAccount:()=>{},reset(){words=[...original];topics=[make("4","omtaler mine forældre","2026-01-01T10:00:00+00:00")];attach={photos:false,files:false};w.QA.attach=attach;}};
const response=(data:unknown,status=200)=>({ok:status<400,status,json:async()=>data});
// Synthetic fixture has no native network capability: no real URL reaches fetch.
w.fetch=async(url:string,opts:any)=>{
 if(!url.startsWith("https://synthetic.invalid/rest/v1/"))throw Error("Network disabled in synthetic fixture");
 const body=opts.body?JSON.parse(opts.body):undefined;
 w.QA.requests.push({url,method:opts.method,body,token:opts.headers.authorization});
 const run=()=>{
 if(w.QA.fail)return response({},503);
 if(url.includes("get_my_attachment_blocks"))return response({block_photos:w.QA.attach.photos,block_files:w.QA.attach.files});
 if(url.includes("set_my_attachment_blocks")){
  w.QA.attach={photos:!!body.p_block_photos,files:!!body.p_block_files};
  return response({block_photos:w.QA.attach.photos,block_files:w.QA.attach.files});
 }
 const istopic=url.includes("topics")||url.includes("topic");
 if(opts.method==="GET")return response((istopic?topics:words).map(x=>({...x})));
 if(url.includes("reset_blocked_words")){words=[];return response(null);}
 if(url.includes("remove_blocked_")){const id=body.p_id;if(istopic)topics=topics.filter(x=>x.id!==id);else words=words.filter(x=>x.id!==id);return response(null,204);}
 const id=String(20+w.QA.requests.length),entry=make(id,body.p_word,"2026-11-07T10:00:00+00:00");if(istopic)topics.push(entry);else words.push(entry);return response(id);
 };
 if(w.QA.pause)return new Promise(resolve=>w.QA.pending.push(()=>resolve(run())));
 return run();
};
const params=new URLSearchParams(location.search);
const lang=(params.get("lang")==="en"?"en":"da") as Lang;
const view=params.get("view")==="notice"?"notice":"sheet";
const theme=params.get("theme")==="dark"?"dark":"light";
const kind=params.get("kind")==="files"?"files":"photos";
const shots=params.get("shots")==="1";
if(shots){words=[make("2","æble","2026-01-01T10:00:00+00:00")];}
if(params.get("photos")==="on")attach.photos=true;
if(params.get("files")==="on")attach.files=true;
w.QA.attach=attach;
document.documentElement.lang=lang;
document.documentElement.dataset.theme=theme;
if(shots){
 document.documentElement.classList.add("qa-shots");
 const s=document.createElement("style");
 s.textContent=".qa-shots .blocking-add,.qa-shots .blocking-foot{display:none}";
 document.head.appendChild(s);
}
function Notice(){
 const da=lang==="da";
 const text=blockedAttachmentNotice(lang,kind==="files"?"files":"photos");
 return <main className="wrap chat-wrap">
  <header className="topbar"><strong className="brand">Rolff</strong><span className="spacer"/><span className="meta">{da?"Samtale":"Chat"}</span></header>
  <div className="card" style={{marginTop:16}}>
   <p className="meta" style={{margin:"4px 0"}}>{kind==="files"?(da?"dokument.pdf · 24 kB":"document.pdf · 24 kB"):(da?"foto.png · 86 kB":"photo.png · 86 kB")}</p>
   <div className="notice" role="alert">{text}</div>
  </div>
 </main>;
}
function Fixture(){
 const [user,setUser]=useState("synthetic-owner-a");w.QA.changeAccount=setUser;useBackNavigationRoot();
 if(view==="notice")return <Notice/>;
 return <main className="wrap">{!shots&&<div className="row"><button onClick={()=>document.documentElement.dataset.theme="light"}>{daBtn("Lyst","Light")}</button><button onClick={()=>document.documentElement.dataset.theme="dark"}>{daBtn("Mørkt","Dark")}</button></div>}<div className="card">{!shots&&<p className="meta">Kun opdigtede data. Ingen netværkskald. / Synthetic data, network disabled.</p>}<h2 style={{margin:"0 0 12px",fontSize:18}}>{lang==="da"?"Blokeringer":"Blocking lists"}</h2><BlockingLists key={user} conv="synthetic-conversation" lang={lang} session={{user:{id:user},access_token:`fabricated-${user}`} as any}/></div></main>;
}
function daBtn(da:string,en:string){return lang==="da"?da:en;}
const root=createRoot(document.getElementById("root")!);root.render(<Fixture/>);w.QA.unmount=()=>root.unmount();

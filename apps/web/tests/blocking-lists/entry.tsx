import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockingLists } from "../../src/BlockingLists";
import { useBackNavigationRoot } from "../../src/backNavigation";
const w=window as any;
const make=(id:string,word:string,time:string)=>({id,word,created_at:time});
const original=[make("1","åben aftale","2026-01-02T10:00:00+00:00"),make("2","æble","2026-01-01T10:00:00+00:00"),make("3","ønske","2026-01-02T10:00:00+00:00")];
let words=[...original],topics=[make("4","omtaler mine forældre","2026-01-01T10:00:00+00:00")];
w.QA={requests:[],fail:false,pause:false,pending:[],changeAccount:()=>{},reset(){words=[...original];}};
const response=(data:unknown,status=200)=>({ok:status<400,status,json:async()=>data});
// Synthetic fixture has no native network capability: no real URL reaches fetch.
w.fetch=async(url:string,opts:any)=>{
 if(!url.startsWith("https://synthetic.invalid/rest/v1/"))throw Error("Network disabled in synthetic fixture");
 const body=opts.body?JSON.parse(opts.body):undefined;
 w.QA.requests.push({url,method:opts.method,body,token:opts.headers.authorization});
 const run=()=>{
 if(w.QA.fail)return response({},503);
 const istopic=url.includes("topics")||url.includes("topic");
 if(opts.method==="GET")return response((istopic?topics:words).map(x=>({...x})));
 if(url.includes("reset_blocked_words")){words=[];return response(null);}
 if(url.includes("remove_blocked_")){const id=body.p_id;if(istopic)topics=topics.filter(x=>x.id!==id);else words=words.filter(x=>x.id!==id);return response(null,204);}
 const id=String(20+w.QA.requests.length),entry=make(id,body.p_word,"2026-11-07T10:00:00+00:00");if(istopic)topics.push(entry);else words.push(entry);return response(id);
 };
 if(w.QA.pause)return new Promise(resolve=>w.QA.pending.push(()=>resolve(run())));
 return run();
};
function Fixture(){
 const [user,setUser]=useState("synthetic-owner-a");w.QA.changeAccount=setUser;useBackNavigationRoot();
 return <main className="wrap"><div className="row"><button onClick={()=>document.documentElement.dataset.theme="light"}>Lyst</button><button onClick={()=>document.documentElement.dataset.theme="dark"}>Mørkt</button></div><div className="card"><p className="meta">Kun opdigtede data. Ingen netværkskald. / Synthetic data, network disabled.</p><BlockingLists key={user} conv="synthetic-conversation" lang="da" session={{user:{id:user},access_token:`fabricated-${user}`} as any}/></div></main>;
}
const root=createRoot(document.getElementById("root")!);root.render(<Fixture/>);w.QA.unmount=()=>root.unmount();

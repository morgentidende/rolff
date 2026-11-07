import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageBubble, ReplyPreview, type Message } from "./MessageBubble";
import "./styles.css";
const samples: Message[] = [
 {id:"1",sender_id:"test-a",sender_name:"Test A",sender_email:"test-a@example.invalid",body:"Kan vi aftale afhentning kl. 16?",created_at:"2026-11-07T15:30:00Z",mine:false},
 {id:"2",sender_id:"test-b",sender_name:"Test B",sender_email:"test-b@example.invalid",body:"Ja, det passer fint.",created_at:"2026-11-07T15:31:00Z",mine:true},
 {id:"3",sender_id:null,sender_name:null,sender_email:null,body:"En længere opdigtet besked, så du kan kontrollere, at tidspunktet bliver nederst til højre, og teksten ikke bliver klippet ved smal skærm.",created_at:"2026-11-07T15:32:00Z",mine:false},
 {id:"4",sender_id:"test-b",sender_name:"Test B",sender_email:"test-b@example.invalid",body:"Tak for beskeden.",created_at:"2026-11-07T15:33:00Z",mine:true,reply_to_id:"1",reply_body:samplesPlaceholder()},
];
function samplesPlaceholder(){return "Kan vi aftale afhentning kl. 16?";}
function Fixture(){const [reply,setReply]=useState<Message|null>(null);const [text,setText]=useState("");const input=useRef<HTMLTextAreaElement>(null);return <main className="wrap"><h1>Beskedtest</h1><p className="meta">Kun opdigtede data. Intet sendes. Hold en besked inde, højreklik, eller fokusér den og tryk Enter.</p><div className="card msgs">{samples.map(m=><MessageBubble key={m.id} m={m} lang="da" onReply={m=>{setReply(m);requestAnimationFrame(()=>input.current?.focus());}}/>)}</div><div className="card composer">{reply&&<div className="reply-composer"><div><span className="meta">Besvarer</span><ReplyPreview body={reply.body} lang="da"/></div><button className="ghost" onClick={()=>setReply(null)} aria-label="Annullér svar">✕</button></div>}<textarea ref={input} value={text} onChange={e=>setText(e.target.value)} aria-label="Skriv en besked" placeholder="Skriv en besked"/><p className="meta">Ingen sendeknap i denne test.</p></div></main>};
createRoot(document.getElementById("root")!).render(<Fixture/>);

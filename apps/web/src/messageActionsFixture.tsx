import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageBubble, ReplyComposer, type Message } from "./MessageBubble";
import "./styles.css";
const samples: Message[] = [
 {id:"1",sender_id:"test-a",sender_name:"Test A",sender_email:"test-a@example.invalid",body:"Kan vi aftale afhentning kl. 16?",created_at:"2026-11-07T15:30:00Z",mine:false},
 {id:"1b",sender_id:"test-a",sender_name:"Test A",sender_email:"test-a@example.invalid",body:"Gerne ved hoveddøren.",created_at:"2026-11-07T15:30:30Z",mine:false},
 {id:"2",sender_id:"test-b",sender_name:"Test B",sender_email:"test-b@example.invalid",body:"Ja, det passer fint.",created_at:"2026-11-07T15:31:00Z",mine:true},
 {id:"2b",sender_id:"test-b",sender_name:"Test B",sender_email:"test-b@example.invalid",body:"Jeg er der kl. 16.",created_at:"2026-11-07T15:31:20Z",mine:true},
 {id:"3",sender_id:"test-a",sender_name:"Test A",sender_email:"test-a@example.invalid",body:"En længere opdigtet besked, så du kan kontrollere, at tidspunktet bliver nederst til højre, og teksten ikke bliver klippet ved smal skærm.",created_at:"2026-11-07T15:32:00Z",mine:false},
 {id:"4",sender_id:"test-b",sender_name:"Test B",sender_email:"test-b@example.invalid",body:"Tak for beskeden.",created_at:"2026-11-07T15:33:00Z",mine:true,reply_to_id:"1",reply_body:samplesPlaceholder()},
];
function samplesPlaceholder(){return "Kan vi aftale afhentning kl. 16?";}
function Fixture(){
  const [reply, setReply] = useState<Message | null>(null);
  const [text, setText] = useState("");
  const [replyFocus, setReplyFocus] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const composerRoot = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!replyFocus) return;
    let cancelled = false;
    const bring = () => {
      if (cancelled) return;
      endRef.current?.scrollIntoView({ block: "end" });
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      composerRoot.current?.scrollIntoView({ block: "nearest" });
      const el = input.current; if (!el) return;
      if (document.activeElement === el) el.blur();
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: "nearest" });
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(bring));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [replyFocus]);
  const beginReply = (m: Message) => { setReply(m); setReplyFocus(n => n + 1); };
  const who = reply ? (reply.mine ? "dig selv" : (reply.sender_name || "Modtageren")) : "";
  return <main className="wrap"><h1>Beskedtest</h1><p className="meta">Kun opdigtede data. Intet sendes. Hold en besked inde, højreklik, eller fokusér den og tryk Enter.</p><div className="msgs" ref={listRef}>{samples.map((m, i) => <MessageBubble key={m.id} m={m} lang="da" tailed={i === 0 || samples[i - 1].mine !== m.mine || samples[i - 1].sender_id !== m.sender_id} onReply={beginReply} />)}<div ref={endRef} /></div><div className="card composer" ref={composerRoot}><div className="composer-input-row"><div className={`composer-entry${reply ? " has-reply" : ""}`}>{reply && <ReplyComposer who={who} body={reply.body} lang="da" onCancel={() => { setReply(null); input.current?.focus(); }} />}<div className="composer-entry-row"><textarea className="message-input" ref={input} value={text} onChange={e => setText(e.target.value)} aria-label="Skriv en besked" placeholder="Skriv en besked" /></div></div></div><div className="composer-count meta" role="status">{[...text].length}/160</div><p className="meta">Ingen sendeknap i denne test.</p></div></main>;
};
createRoot(document.getElementById("root")!).render(<Fixture/>);

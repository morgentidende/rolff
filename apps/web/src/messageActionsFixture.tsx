import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageBubble, ReplyComposer, type Message } from "./MessageBubble";
import "./styles.css";

const q = new URLSearchParams(location.search);
const lang = q.get("lang") === "en" ? "en" : "da";
const theme = q.get("theme") === "dark" ? "dark" : "light";
const openMenu = q.get("open") === "1";
document.documentElement.lang = lang;
document.documentElement.dataset.theme = theme;

function base(): Message[] {
  return [
    { id: "1", sender_id: "test-a", sender_name: "Test A", sender_email: "test-a@example.invalid", body: lang === "da" ? "Kan vi aftale afhentning kl. 16?" : "Can we arrange pickup at 16:00?", created_at: "2026-11-07T15:30:00Z", mine: false },
    { id: "1b", sender_id: "test-a", sender_name: "Test A", sender_email: "test-a@example.invalid", body: lang === "da" ? "Gerne ved hoveddøren." : "At the front door is fine.", created_at: "2026-11-07T15:30:30Z", mine: false, thumb_count: 1, i_thumbed: true },
    { id: "2", sender_id: "test-b", sender_name: "Test B", sender_email: "test-b@example.invalid", body: lang === "da" ? "Ja, det passer fint." : "Yes, that works well.", created_at: "2026-11-07T15:31:00Z", mine: true },
    { id: "2b", sender_id: "test-b", sender_name: "Test B", sender_email: "test-b@example.invalid", body: lang === "da" ? "Jeg er der kl. 16." : "I will be there at 16:00.", created_at: "2026-11-07T15:31:20Z", mine: true, thumb_count: 2, i_thumbed: true },
    { id: "3", sender_id: "test-a", sender_name: "Test A", sender_email: "test-a@example.invalid", body: lang === "da" ? "En længere opdigtet besked, så du kan kontrollere, at tidspunktet bliver nederst til højre, og teksten ikke bliver klippet ved smal skærm." : "A longer invented message, so you can check that the time stays at the bottom right and the text is not clipped on a narrow screen.", created_at: "2026-11-07T15:32:00Z", mine: false },
    { id: "4", sender_id: "test-b", sender_name: "Test B", sender_email: "test-b@example.invalid", body: lang === "da" ? "Tak for beskeden." : "Thanks for the message.", created_at: "2026-11-07T15:33:00Z", mine: true, reply_to_id: "1", reply_body: lang === "da" ? "Kan vi aftale afhentning kl. 16?" : "Can we arrange pickup at 16:00?" },
  ];
}

function Fixture() {
  const [msgs, setMsgs] = useState<Message[]>(base);
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
  useEffect(() => {
    if (!openMenu) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-i="1"]');
    el?.focus();
    el?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, []);
  const beginReply = (m: Message) => { setReply(m); setReplyFocus(n => n + 1); };
  const toggleThumb = (m: Message) => {
    setMsgs((list) => list.map((x) => {
      if (x.id !== m.id) return x;
      const next = !x.i_thumbed;
      return { ...x, i_thumbed: next, thumb_count: Math.max(0, (x.thumb_count ?? 0) + (next ? 1 : -1)) };
    }));
  };
  const who = reply ? (reply.mine ? (lang === "da" ? "dig selv" : "yourself") : (reply.sender_name || (lang === "da" ? "Modtageren" : "The recipient"))) : "";
  const da = lang === "da";
  return <main className="wrap chat-wrap"><header className="topbar chat"><span className="chattitle">{da ? "Samtale (test)" : "Conversation (test)"}</span></header><div className="msgs" ref={listRef}>{msgs.map((m, i) => <MessageBubble key={m.id} m={m} lang={lang} index={i} tailed={i === 0 || msgs[i - 1].mine !== m.mine || msgs[i - 1].sender_id !== m.sender_id} onReply={beginReply} onThumb={toggleThumb} />)}<div ref={endRef} /></div><div className="card composer" ref={composerRoot}><div className="composer-input-row"><div className={`composer-entry${reply ? " has-reply" : ""}`}>{reply && <ReplyComposer who={who} body={reply.body} lang={lang} onCancel={() => { setReply(null); input.current?.focus(); }} />}<div className="composer-entry-row"><textarea className="message-input" ref={input} value={text} onChange={e => setText(e.target.value)} aria-label={da ? "Skriv en besked" : "Write a message"} placeholder={da ? "Skriv en besked" : "Write a message"} /></div></div></div><div className="composer-count meta" role="status">{[...text].length}/160</div><p className="meta">{da ? "Ingen sendeknap i denne test." : "No send button in this test."}</p></div></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);

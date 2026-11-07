import { useBackLayer } from "./backNavigation";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Message = { id: string; sender_id: string | null; sender_name: string | null; sender_email?: string | null; body: string; created_at: string; mine: boolean; att_mime?: string | null; att_name?: string | null; att_alt?: string | null; att_pages?: number | null; reply_to_id?: string | null; reply_body?: string | null; has_reply?: boolean };
import { messageTime } from "./messageTime";
export function ReplyPreview({ body, unavailable = false, lang }: { body?: string | null; unavailable?: boolean; lang: string }) {
  return <blockquote className="reply-quote">{unavailable ? (lang === "da" ? "Den oprindelige besked er ikke tilgængelig." : "The original message is unavailable.") : [...(body ?? "")].slice(0, 200).join("") + ([...(body ?? "")].length > 200 ? "…" : "")}</blockquote>;
}
export function MessageBubble({ m, lang, children, onReply, canReply = true, hit = false, index }: { m: Message; lang: string; children?: React.ReactNode; onReply: (m: Message) => void; canReply?: boolean; hit?: boolean; index?: number }) {
  const da = lang === "da";
  const [panel, setPanel] = useState<"actions" | "info" | null>(null);
  useBackLayer(panel!==null,()=>setPanel(panel==="info"?"actions":null));
  const [feedback, setFeedback] = useState("");
  const bubble = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; start.current = null; };
  const close = () => { setPanel(null); bubble.current?.focus({ preventScroll: true }); };
  useEffect(() => { const stop = () => cancel(); window.addEventListener("scroll", stop, true); return () => { cancel(); window.removeEventListener("scroll", stop, true); }; }, []);
  useEffect(() => {
    if (!panel) return;
    dialog.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keys); return () => document.removeEventListener("keydown", keys);
  }, [panel]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.body); setFeedback(da ? "Beskeden er kopieret." : "Message copied."); }
    catch { setFeedback(da ? "Beskeden kunne ikke kopieres. Prøv igen." : "Could not copy. Try again."); }
    close();
  };
  return <>
    <div ref={bubble} tabIndex={0} data-i={index} className={`msg ${m.mine ? "mine" : "theirs"}${hit ? " hit" : ""}`} aria-label={da ? "Besked. Hold inde for handlinger, eller tryk Enter." : "Message. Hold for actions, or press Enter."} aria-haspopup="dialog" aria-expanded={!!panel}
      onPointerDown={e => { cancel(); if (e.button !== 0 || (e.target as HTMLElement).closest("button,a,input,textarea")) return; start.current = { x: e.clientX, y: e.clientY }; timer.current = setTimeout(() => { cancel(); window.getSelection()?.removeAllRanges(); setPanel("actions"); }, 500); }}
      onPointerMove={e => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={e => { if ((e.target as HTMLElement).closest("button,a")) return; e.preventDefault(); cancel(); setPanel("actions"); }}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); setPanel("actions"); } }}>
      {(m.reply_to_id || m.has_reply) && <ReplyPreview body={m.reply_body} unavailable={m.reply_body == null} lang={lang} />}
      <div className="message-content">{children ?? m.body}</div>
      <time className="message-time" dateTime={m.created_at}>{messageTime(m.created_at, lang)}</time>
    </div>
    {feedback && <p className="meta message-feedback" role="status">{feedback}</p>}
    {panel && createPortal(<div className="message-overlay" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="message-panel" ref={dialog} role="dialog" aria-modal="true" aria-label={panel === "info" ? (da ? "Information" : "Information") : (da ? "Beskedhandlinger" : "Message actions")}>
        {panel === "actions" ? <>
          <button type="button" disabled={!canReply} onClick={() => { close(); onReply(m); }}>{da ? "Besvar" : "Reply"}</button>
          <button type="button" onClick={copy}>{da ? "Kopiér" : "Copy"}</button>
          <button type="button" onClick={() => setPanel("info")}>Information</button>
        </> : <>
          <h2>Information</h2>
          <dl><dt>{da ? "Afsenders e-mail" : "Sender email"}</dt><dd>{m.sender_email || (da ? "Ikke tilgængelig" : "Unavailable")}</dd>
          <dt>{da ? "Dato" : "Date"}</dt><dd>{new Date(m.created_at).toLocaleDateString(da ? "da-DK" : "en-GB", { dateStyle: "long" })}</dd>
          <dt>{da ? "Tidspunkt" : "Time"}</dt><dd>{messageTime(m.created_at, lang)}</dd></dl>
          <button type="button" onClick={close}>{da ? "Luk" : "Close"}</button>
        </>}
      </div>
    </div>, document.body)}
  </>;
}

import { useBackLayer } from "./backNavigation";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rectOf, useAnchoredPlacement } from "./anchoredPosition";
const ActionIcon = ({ d }: { d: React.ReactNode }) => <svg className="message-action-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{d}</svg>;
const icons = {
  reply: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5v.01" /></>,
};

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
  const bubble = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null), lifted = useRef<HTMLDivElement>(null);
  // The panel is anchored to the pressed bubble: below it, flipped above near
  // the bottom/keyboard, and aligned to the bubble's side. A non-interactive
  // copy of the bubble is drawn above the dimmed backdrop so it stays sharp.
  const { pos } = useAnchoredPlacement(panel !== null, () => {
    const r = rectOf(bubble.current);
    if (r && lifted.current) Object.assign(lifted.current.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.right - r.left}px` });
    return r;
  }, dialog, { align: m.mine ? "end" : "start", gap: 8, margin: 12, minVisible: 140 }, panel);
  const isOpen = panel !== null;
  useLayoutEffect(() => {
    if (!isOpen || !bubble.current || !lifted.current) return;
    const copy = bubble.current.cloneNode(true) as HTMLElement;
    for (const el of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("*"))]) { el.removeAttribute("id"); el.removeAttribute("tabindex"); el.removeAttribute("aria-label"); el.removeAttribute("aria-haspopup"); el.removeAttribute("aria-expanded"); el.removeAttribute("data-i"); }
    copy.classList.remove("hit"); copy.classList.add("msg-lifted-copy");
    lifted.current.replaceChildren(copy);
  }, [isOpen]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; start.current = null; };
  const close = () => { setPanel(null); bubble.current?.focus({ preventScroll: true }); };
  useEffect(() => { const stop = () => cancel(); window.addEventListener("scroll", stop, true); return () => { cancel(); window.removeEventListener("scroll", stop, true); }; }, []);
  useEffect(() => {
    if (!panel) return;
    dialog.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const keys = (e: KeyboardEvent) => {
      if (panel === "actions" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        items[next].focus({ preventScroll: true });
        return;
      }
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
    <div ref={bubble} tabIndex={0} data-i={index} className={`msg ${m.mine ? "mine" : "theirs"}${hit ? " hit" : ""}`} aria-label={da ? "Besked. Hold inde for handlinger, eller tryk Enter." : "Message. Hold for actions, or press Enter."} aria-haspopup="menu" aria-expanded={!!panel}
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
      <div className="message-lifted" ref={lifted} aria-hidden="true" />
      <div className={`message-panel${panel === "info" ? " message-info" : ""}${pos ? " placed-" + pos.placement : ""}`} ref={dialog} data-placement={pos?.placement}
        role={panel === "info" ? "dialog" : "menu"} aria-modal={panel === "info" ? true : undefined} aria-orientation={panel === "actions" ? "vertical" : undefined}
        aria-label={panel === "info" ? (da ? "Information" : "Information") : (da ? "Beskedhandlinger" : "Message actions")}
        style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight, maxWidth: pos.maxWidth } : { top: 0, left: 0, visibility: "hidden" }}>
        {panel === "actions" ? <>
          <button type="button" role="menuitem" disabled={!canReply} onClick={() => { close(); onReply(m); }}><ActionIcon d={icons.reply} /><span>{da ? "Besvar" : "Reply"}</span></button>
          <button type="button" role="menuitem" onClick={copy}><ActionIcon d={icons.copy} /><span>{da ? "Kopiér" : "Copy"}</span></button>
          <button type="button" role="menuitem" onClick={() => setPanel("info")}><ActionIcon d={icons.info} /><span>Information</span></button>
        </> : <>
          <h2>Information</h2>
          <dl><dt>{da ? "Afsenders e-mail" : "Sender email"}</dt><dd>{m.sender_email || (da ? "Ikke tilgængelig" : "Unavailable")}</dd>
          <dt>{da ? "Dato" : "Date"}</dt><dd>{new Date(m.created_at).toLocaleDateString(da ? "da-DK" : "en-GB", { dateStyle: "long" })}</dd>
          <dt>{da ? "Tidspunkt" : "Time"}</dt><dd>{messageTime(m.created_at, lang)}</dd></dl>
          <button type="button" className="message-info-close" onClick={close}>{da ? "Luk" : "Close"}</button>
        </>}
      </div>
    </div>, document.body)}
  </>;
}

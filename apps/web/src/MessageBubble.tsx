import { useBackLayer } from "./backNavigation";
import { showToast } from "./toast";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rectOf, useAnchoredPlacement } from "./anchoredPosition";
const ActionIcon = ({ d }: { d: React.ReactNode }) => <svg className="message-action-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{d}</svg>;
const icons = {
  reply: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5v.01" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
};

export type Message = { id: string; sender_id: string | null; sender_name: string | null; sender_email?: string | null; body: string; created_at: string; mine: boolean; att_mime?: string | null; att_name?: string | null; att_alt?: string | null; att_pages?: number | null; reply_to_id?: string | null; reply_body?: string | null; has_reply?: boolean; deliver_after?: string | null; thumb_count?: number; i_thumbed?: boolean };
import { messageTime } from "./messageTime";
export function ReplyPreview({ body, unavailable = false, lang }: { body?: string | null; unavailable?: boolean; lang: string }) {
  return <blockquote className="reply-quote">{unavailable ? (lang === "da" ? "Den oprindelige besked er ikke tilgængelig." : "The original message is unavailable.") : [...(body ?? "")].slice(0, 200).join("") + ([...(body ?? "")].length > 200 ? "…" : "")}</blockquote>;
}
/** Compact one-line quote inside the composer (Signal/WhatsApp style). */
export function ReplyComposer({ who, body, unavailable = false, lang, onCancel }: { who: string; body?: string | null; unavailable?: boolean; lang: string; onCancel: () => void }) {
  const da = lang === "da";
  const quote = unavailable
    ? (da ? "Den oprindelige besked er ikke tilgængelig." : "The original message is unavailable.")
    : (body ?? "").replace(/\s+/g, " ").trim();
  return (
    <div className="reply-composer" role="status">
      <div className="reply-composer-main">
        <span className="reply-composer-who">{da ? `Svarer ${who}` : `Replying to ${who}`}</span>
        <p className="reply-composer-text">{quote || (da ? "Tom besked" : "Empty message")}</p>
      </div>
      <button type="button" className="reply-composer-close" aria-label={da ? "Annullér svar" : "Cancel reply"} onClick={onCancel}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}
const clearSelection = () => { try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ } };
export function MessageBubble({ m, lang, children, onReply, canReply = true, onThumb, canReact = true, hit = false, index, tailed = false, flash = false, pendingSec = null, onEdit, onDelete }: { m: Message; lang: string; children?: React.ReactNode; onReply: (m: Message) => void; canReply?: boolean; onThumb?: (m: Message) => void; canReact?: boolean; hit?: boolean; index?: number; tailed?: boolean; flash?: boolean; pendingSec?: number | null; onEdit?: (m: Message) => void; onDelete?: (m: Message) => void }) {
  const pending = m.mine && pendingSec != null && pendingSec > 0;
  const da = lang === "da";
  const [panel, setPanel] = useState<"actions" | "info" | null>(null);
  // After a long-press open, the finger is still down where the menu appears.
  // Ignore the trailing release/click and keep the panel non-interactive until then.
  const [armed, setArmed] = useState(false);
  useBackLayer(panel!==null,()=>setPanel(panel==="info"?"actions":null));
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
  const close = () => { setArmed(false); setPanel(null); bubble.current?.focus({ preventScroll: true }); };
  const openActions = (fromHold: boolean) => {
    cancel();
    clearSelection();
    if (fromHold) setArmed(true);
    else setArmed(false);
    setPanel("actions");
  };
  useEffect(() => { const stop = () => cancel(); window.addEventListener("scroll", stop, true); return () => { cancel(); window.removeEventListener("scroll", stop, true); }; }, []);
  // Clear any native selection the long-press left behind, and keep clearing
  // while the menu is open so Android cannot re-select "Besvar" under the finger.
  useEffect(() => {
    if (!panel) return;
    clearSelection();
    const id = requestAnimationFrame(clearSelection);
    const onSel = () => clearSelection();
    document.addEventListener("selectionchange", onSel);
    return () => { cancelAnimationFrame(id); document.removeEventListener("selectionchange", onSel); };
  }, [panel]);
  // Hold-open arming: swallow the releasing pointer and delay focus so the
  // first menu item is not clicked or text-selected under the still-down finger.
  useEffect(() => {
    if (!armed) return;
    clearSelection();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearSelection();
      setArmed(false);
    };
    const onUp = () => { clearSelection(); window.setTimeout(finish, 40); };
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    const fallback = window.setTimeout(finish, 700);
    return () => {
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.clearTimeout(fallback);
    };
  }, [armed]);
  useEffect(() => {
    if (!panel || armed) return;
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
  }, [panel, armed]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.body); showToast(da ? "Kopieret" : "Copied"); }
    catch { showToast(da ? "Kunne ikke kopiere" : "Could not copy"); }
    close();
  };
  const guarded = (fn: () => void) => (e: React.MouseEvent) => {
    if (armed) { e.preventDefault(); e.stopPropagation(); return; }
    fn();
  };
  const thumbs = m.thumb_count ?? 0;
  const iThumbed = !!m.i_thumbed;
  const canToggleThumb = !!onThumb && (iThumbed || canReact);
  const thumbLabel = iThumbed
    ? (da ? "Fjern" : "Remove")
    : (da ? "Svar med 👍" : "Reply with 👍");
  const thumbAria = iThumbed
    ? (da ? "Fjern dit 👍" : "Remove your 👍")
    : (da ? "Svar på beskeden med 👍" : "Reply to the message with 👍");
  const pillAria = iThumbed
    ? (da ? "Dit 👍. Tryk for at fjerne." : "Your 👍. Tap to remove.")
    : thumbs > 1
      ? (da ? `${thumbs} × 👍 på beskeden` : `${thumbs} × 👍 on this message`)
      : (da ? "👍 på beskeden" : "👍 on this message");
  const doThumb = () => { if (canToggleThumb) onThumb?.(m); };
  return <>
    <div className={`msg-cluster${m.mine ? " mine" : ""}`}>
    <div ref={bubble} tabIndex={0} data-i={index} className={`msg ${m.mine ? "mine" : "theirs"}${tailed ? " tailed" : ""}${hit ? " hit" : ""}${flash ? " just-accepted" : ""}${pending ? " pending-send" : ""}${thumbs > 0 ? " has-thumb" : ""}`} aria-label={pending ? (da ? `Forsinket besked, sendes om ${pendingSec} s. Ret eller slet, eller tryk på send for at sende nu.` : `Delayed message, sending in ${pendingSec} s. Edit or delete, or tap send to send now.`) : (da ? "Besked. Hold inde for handlinger, eller tryk Enter." : "Message. Hold for actions, or press Enter.")} aria-haspopup="menu" aria-expanded={!!panel}
      onPointerDown={e => { cancel(); if (e.button !== 0 || (e.target as HTMLElement).closest("button,a,input,textarea")) return; start.current = { x: e.clientX, y: e.clientY }; timer.current = setTimeout(() => openActions(true), 500); }}
      onPointerMove={e => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={e => { if ((e.target as HTMLElement).closest("button,a")) return; e.preventDefault(); openActions(false); }}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); openActions(false); } }}>
      {(m.reply_to_id || m.has_reply) && <ReplyPreview body={m.reply_body} unavailable={m.reply_body == null} lang={lang} />}
      {/* Time sits inside the bubble at the bottom right; the invisible spacer reserves room on the last
          text line so it never overlaps the text. */}
      <div className="message-content">{children ?? m.body}<span className="msg-meta-spacer" aria-hidden="true" /></div>
      <span className="msg-meta"><time className="message-time" dateTime={m.created_at}>{messageTime(m.created_at, lang)}</time>{pending && <span className="msg-pending-sec" aria-hidden="true"> · {pendingSec} s</span>}</span>
      {!pending && thumbs > 0 && <button type="button" className={`msg-thumb${iThumbed ? " is-mine" : ""}`} aria-label={pillAria} disabled={!canToggleThumb} onClick={e => { e.stopPropagation(); doThumb(); }} onPointerDown={e => e.stopPropagation()}><span aria-hidden="true">👍</span>{thumbs > 1 && <span className="msg-thumb-n">{thumbs}</span>}</button>}
    </div>
    {pending && <div className="msg-pending-actions">
      {onEdit && !m.att_mime && <button type="button" className="ghost" onClick={() => onEdit(m)}>{da ? "Ret" : "Edit"}</button>}
      {onDelete && <button type="button" className="ghost danger" onClick={() => onDelete(m)}>{da ? "Slet" : "Delete"}</button>}
    </div>}
    </div>
    {panel && createPortal(<div className="message-overlay" onPointerDown={e => { if (armed) { e.preventDefault(); return; } if (e.target === e.currentTarget) close(); }} onContextMenu={e => e.preventDefault()}>
      <div className="message-lifted" ref={lifted} aria-hidden="true" />
      <div className={`message-panel${panel === "info" ? " message-info" : ""}${pos ? " placed-" + pos.placement : ""}${armed ? " is-armed" : ""}`} ref={dialog} data-placement={pos?.placement} data-armed={armed ? "true" : undefined}
        role={panel === "info" ? "dialog" : "menu"} aria-modal={panel === "info" ? true : undefined} aria-orientation={panel === "actions" ? "vertical" : undefined}
        aria-label={panel === "info" ? (da ? "Information" : "Information") : (da ? "Beskedhandlinger" : "Message actions")}
        onContextMenu={e => e.preventDefault()}
        style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight, maxWidth: pos.maxWidth } : { top: 0, left: 0, visibility: "hidden" }}>
        {panel === "actions" ? <>
          {pending && onEdit && !m.att_mime && <button type="button" role="menuitem" onClick={guarded(() => { close(); onEdit(m); })}><ActionIcon d={icons.edit} /><span>{da ? "Ret" : "Edit"}</span></button>}
          {pending && onDelete && <button type="button" role="menuitem" onClick={guarded(() => { close(); onDelete(m); })}><ActionIcon d={icons.trash} /><span>{da ? "Slet" : "Delete"}</span></button>}
          {!pending && <button type="button" role="menuitem" className="message-thumb-item" aria-label={thumbAria} aria-pressed={iThumbed} disabled={!canToggleThumb} onClick={guarded(() => { close(); doThumb(); })}><span className="message-thumb-emoji" aria-hidden="true">👍</span><span>{thumbLabel}</span></button>}
          {!pending && <div className="message-menu-sep" role="separator" />}
          <button type="button" role="menuitem" disabled={!canReply || pending} onClick={guarded(() => { close(); onReply(m); })}><ActionIcon d={icons.reply} /><span>{da ? "Besvar" : "Reply"}</span></button>
          <button type="button" role="menuitem" onClick={guarded(copy)}><ActionIcon d={icons.copy} /><span>{da ? "Kopiér" : "Copy"}</span></button>
          <button type="button" role="menuitem" onClick={guarded(() => setPanel("info"))}><ActionIcon d={icons.info} /><span>Information</span></button>
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

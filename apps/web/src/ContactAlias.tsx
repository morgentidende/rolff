import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "./i18n";

export type AliasContact = { user_id: string; email: string; alias: string | null };

/** A short tap opens the conversation; a cancelled gesture must never navigate. */
export function ContactButton({ children, open, rename }: { children: React.ReactNode; open: () => void; rename: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppress = useRef(false);
  const clear = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const cancel = () => { if (start.current) suppress.current = true; start.current = null; clear(); };
  useEffect(() => {
    document.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    return () => { clear(); document.removeEventListener("scroll", cancel, true); window.removeEventListener("blur", cancel); };
  }, []);
  const show = () => { clear(); suppress.current = true; rename(); };
  return <button type="button" className="convbtn contact-button" aria-keyshortcuts="Shift+F10"
    onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; clear(); suppress.current = false; start.current = { x: e.clientX, y: e.clientY }; timer.current = setTimeout(show, 500); }}
    onPointerMove={e => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel(); }}
    onPointerUp={() => { clear(); start.current = null; }} onPointerCancel={cancel} onPointerLeave={cancel}
    onContextMenu={e => { e.preventDefault(); show(); }}
    onKeyDown={e => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); show(); } else if (e.key === "Enter" || e.key === " ") suppress.current = false; }}
    onClick={e => { if (suppress.current) { suppress.current = false; e.preventDefault(); return; } open(); }}>{children}</button>;
}

/** Only the existing owner-scoped contact-alias RPC is supplied by the caller. */
export function ContactAliasDialog({ lang, contacts, save, saved, close }: {
  lang: Lang; contacts: AliasContact[]; save: (id: string, alias: string) => Promise<void>;
  saved: (id: string, alias: string | null) => void; close: () => void;
}) {
  const da = lang === "da";
  const initial = contacts.length === 1 ? contacts[0] : null;
  const [id, setId] = useState(initial?.user_id ?? "");
  const [value, setValue] = useState(initial?.alias ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null);
  const inflight = useRef(false); const mounted = useRef(true);
  const backdropDown = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const d = dialog.current; d?.showModal(); input.current?.focus();
    return () => { mounted.current = false; d?.close(); if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  const dismiss = () => { if (!inflight.current) close(); };
  const submit = async (alias: string) => {
    if (!id || inflight.current) return;
    inflight.current = true; setBusy(true); setErr("");
    try { await save(id, alias); if (mounted.current) saved(id, alias.trim() || null); }
    catch { if (mounted.current) setErr(da ? "Vi kunne ikke bekræfte, at kaldenavnet blev gemt. Prøv igen." : "We could not confirm that the nickname was saved. Please try again."); }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  };
  const selected = contacts.find(c => c.user_id === id);
  return <dialog ref={dialog} className="contact-alias-dialog" aria-labelledby="contact-alias-title"
    onPointerDown={e => { backdropDown.current = e.target === e.currentTarget; }}
    onCancel={e => { e.preventDefault(); close(); }} onClick={e => {
      // Only a press that STARTED on the backdrop dismisses: the release of the long-press that
      // opened this dialog must not close it again.
      const started = backdropDown.current; backdropDown.current = false;
      if (e.target !== e.currentTarget || !started) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dismiss();
    }}>
    <div className="sheethead"><h2 id="contact-alias-title">{da ? "Kontaktens kaldenavn" : "Contact nickname"}</h2><button type="button" className="icon" aria-label={da ? "Luk" : "Close"} disabled={busy} onClick={dismiss}>✕</button></div>
    <p className="meta">{da ? "Kun du kan se dette navn. Personens profil og navn hos andre ændres ikke." : "Only you can see this name. Their profile and name for others are unchanged."}</p>
    {!contacts.length ? <p>{da ? "Kaldenavnet kan ændres, når invitationen er accepteret." : "You can change the nickname after the invitation is accepted."}</p> : <>
      {contacts.length > 1 && <label>{da ? "Vælg person" : "Choose person"}<select value={id} disabled={busy} onChange={e => { const c = contacts.find(c => c.user_id === e.target.value); setId(c?.user_id ?? ""); setValue(c?.alias ?? ""); setErr(""); }}><option value="">{da ? "Vælg person…" : "Choose person…"}</option>{contacts.map(c => <option key={c.user_id} value={c.user_id}>{c.alias || c.email}</option>)}</select></label>}
      {selected && <form onSubmit={e => { e.preventDefault(); void submit(value); }}>
        <label htmlFor="contact-alias-input">{da ? "Kaldenavn" : "Nickname"}</label><input ref={input} id="contact-alias-input" maxLength={40} value={value} placeholder={selected.email} disabled={busy} onChange={e => { setValue(e.target.value); setErr(""); }} />
        <p className="meta">{da ? "Nulstil for at vise personens oprindelige navn igen." : "Reset to show the person's original name again."}</p>
        <div className="row end"><button type="button" className="ghost" disabled={busy} onClick={() => void submit("")}>{da ? "Nulstil kaldenavn" : "Reset nickname"}</button><button type="submit" disabled={busy}>{busy ? (da ? "Gemmer…" : "Saving…") : (da ? "Gem" : "Save")}</button><button type="button" className="ghost" disabled={busy} onClick={dismiss}>{da ? "Annuller" : "Cancel"}</button></div>
      </form>}
    </>}
    {err && <p className="err" role="alert">{err}</p>}
  </dialog>;
}

import { useEffect, useRef } from "react";
import { useBackLayer } from "./backNavigation";
import type { Lang } from "./i18n";

/** The only thing a pending invitation row offers (tap, long press or the keyboard menu key): two choices.
 * There is no chat to open until the invitee has accepted. All explanations live in the FAQ. */
export function PendingInviteMenu({ lang, title, rename, cancelInvite, close }: { lang: Lang; title: string; rename: () => void; cancelInvite: () => void; close: () => void }) {
  const da = lang === "da", ref = useRef<HTMLDialogElement>(null), backdropDown = useRef(false), first = useRef<HTMLButtonElement>(null);
  useBackLayer(true, close);
  useEffect(() => { const d = ref.current; if (d && !d.open) { try { d.showModal(); } catch { d.setAttribute("open", ""); } } first.current?.focus(); }, []);
  return (
    <dialog ref={ref} className="contact-alias-dialog pending-invite-menu" aria-label={title} onCancel={(e) => { e.preventDefault(); close(); }}
      onPointerDown={(e) => { backdropDown.current = e.target === e.currentTarget; }}
      // Only a press that STARTED on the backdrop dismisses: the release of the long press that opened the menu must not.
      onClick={(e) => { const started = backdropDown.current; backdropDown.current = false; if (e.target === e.currentTarget && started) close(); }}>
      <div className="sheethead"><h2>{title}</h2><button type="button" className="icon" onClick={close} aria-label={da ? "Luk" : "Close"}>✕</button></div>
      <div className="pending-invite-actions">
        <button type="button" ref={first} className="ghost" onClick={rename}>{da ? "Ændr kaldenavn" : "Change nickname"}</button>
        <button type="button" className="ghost pending-invite-cancel" onClick={cancelInvite}>{da ? "Annullér invitation" : "Cancel invitation"}</button>
      </div>
    </dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backNavigation";
import { MUTE_DURATIONS, muteMenuLabel, unmuteLabel, type MuteDuration, type MuteRow } from "./muteModel";
import type { Lang } from "./i18n";

/** WhatsApp-style "Lydløs" dialog: 8 timer / 24 timer / 1 uge / Altid, Annuller and OK. */
export function MuteDialog({ lang, current, done, onUnmute }: { lang: Lang; current: MuteRow | null; done: (d: MuteDuration | null) => void; onUnmute: () => void }) {
  const da = lang === "da";
  const [pick, setPick] = useState<MuteDuration>("8h");
  const box = useRef<HTMLDivElement>(null), firstRef = useRef<HTMLInputElement>(null);
  const prev = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  useBackLayer(true, () => done(null));
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
    const back = prev.current;
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true }); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { done(null); return; }
    if (e.key !== "Tab") return;
    const f = Array.from(box.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled])") ?? []);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
    e.preventDefault(); f[next].focus();
  };
  return (
    <div className="overlay confirm-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <div className="confirm-card mute-card" role="dialog" aria-modal="true" aria-labelledby="mute-title" aria-describedby="mute-body" ref={box} onKeyDown={trap}>
        <h2 id="mute-title">{da ? "Lydløs" : "Mute"}</h2>
        <p id="mute-body">{da
          ? "Du får ingen notifikationer fra denne samtale. Beskeder når frem som normalt, og den anden part kan ikke se, at den er lydløs."
          : "You get no notifications from this conversation. Messages still arrive as normal, and the other party cannot see that it is muted."}</p>
        {current && <p className="mute-state" role="status">{muteMenuLabel(current, da)}</p>}
        <div className="mute-options" role="radiogroup" aria-label={da ? "Hvor længe?" : "For how long?"}>
          {MUTE_DURATIONS.map((o, i) => <label key={o.id} className="mute-option">
            <input ref={i === 0 ? firstRef : undefined} type="radio" name="mute-duration" value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
            <span className="mute-radio" aria-hidden="true" /><span>{da ? o.da : o.en}</span>
          </label>)}
        </div>
        {current && <button type="button" className="text-link mute-unmute" onClick={onUnmute}>{unmuteLabel(da)}</button>}
        <div className="confirm-actions">
          <button type="button" className="ghost" onClick={() => done(null)}>{da ? "Annuller" : "Cancel"}</button>
          <button type="button" onClick={() => done(pick)}>OK</button>
        </div>
      </div>
    </div>
  );
}

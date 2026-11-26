import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backNavigation";
import { CardHeader } from "./CardHeader";
import { useBackdropDismiss, useModalLayer, useUnderChatHeader } from "./modalLayer";
import { MUTE_DURATIONS, type MuteDuration } from "./muteModel";
import type { Lang } from "./i18n";

/** WhatsApp-style mute dialog: 8 timer / 1 uge / Altid, X to close, OK to save. Close is the top-right X only. */
export function MuteDialog({ lang, done }: { lang: Lang; done: (d: MuteDuration | null) => void }) {
  const da = lang === "da";
  const [pick, setPick] = useState<MuteDuration>("8h");
  const box = useRef<HTMLDivElement>(null), firstRef = useRef<HTMLInputElement>(null);
  const prev = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const layer = useRef<HTMLDivElement>(null);
  useBackLayer(true, () => done(null));
  useModalLayer(true, layer);
  const backdrop = useBackdropDismiss(() => done(null));
  const underHeader = useUnderChatHeader();
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
    <div className={underHeader !== null ? "overlay confirm-overlay top-overlay" : "overlay confirm-overlay"} ref={layer} style={underHeader !== null ? { paddingTop: underHeader } : undefined} {...backdrop}>
      <div className="confirm-card mute-card" role="dialog" aria-modal="true" aria-labelledby="mute-title" ref={box} onKeyDown={trap}>
        <CardHeader title={da ? "Slå notifikationer fra" : "Mute notifications"} titleId="mute-title" lang={lang} onClose={() => done(null)} />
        <div className="mute-options" role="radiogroup" aria-label={da ? "Hvor længe?" : "For how long?"}>
          {MUTE_DURATIONS.map((o, i) => <label key={o.id} className="mute-option">
            <input ref={i === 0 ? firstRef : undefined} type="radio" name="mute-duration" value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
            <span className="mute-radio" aria-hidden="true" /><span>{da ? o.da : o.en}</span>
          </label>)}
        </div>
        <div className="confirm-actions mute-actions">
          <button type="button" onClick={() => done(pick)}>OK</button>
        </div>
      </div>
    </div>
  );
}

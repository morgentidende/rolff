import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backNavigation";

// In-app replacement for window.confirm: Rolff-styled, aria-modal, focus-trapped,
// Esc / Android back = cancel. Promise-based so callers read like confirm().
export type ConfirmOptions = { title: string; body?: string; confirm: string; cancel: string; danger?: boolean };
type Req = ConfirmOptions & { resolve: (ok: boolean) => void };
const EVENT = "rolff:confirm";

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  // Next tick: lets a closing overflow menu release its back layer / focus first.
  return new Promise((resolve) => { setTimeout(() => window.dispatchEvent(new CustomEvent<Req>(EVENT, { detail: { ...o, resolve } })), 0); });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<Req>).detail; setReq((cur) => { cur?.resolve(false); return d; }); };
    window.addEventListener(EVENT, on); return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!req) return null;
  return <ConfirmView key={req.title + (req.body ?? "")} req={req} done={(ok) => { req.resolve(ok); setReq(null); }} />;
}

function ConfirmView({ req, done }: { req: Req; done: (ok: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const prev = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  useBackLayer(true, () => done(false));
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
    const back = prev.current;
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true }); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const f = Array.from(box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
    e.preventDefault(); f[next].focus();
  };
  return (
    <div className="overlay confirm-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={req.body ? "confirm-body" : undefined} ref={box} onKeyDown={trap}>
        <h2 id="confirm-title">{req.title}</h2>
        {req.body && <p id="confirm-body">{req.body}</p>}
        <div className="confirm-actions">
          <button type="button" ref={cancelRef} className="ghost" onClick={() => done(false)}>{req.cancel}</button>
          <button type="button" className={req.danger ? "danger" : undefined} onClick={() => done(true)}>{req.confirm}</button>
        </div>
      </div>
    </div>
  );
}

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backNavigation";
import { CardHeader, closeLabel } from "./CardHeader";
import { useBackdropDismiss, useModalLayer, useUnderChatHeader } from "./modalLayer";

// In-app replacement for window.confirm: Rolff-styled, aria-modal, focus-trapped,
// Esc / Android back / ✕ = cancel. Promise-based so callers read like confirm().
// `cancel` is accepted for call-site compatibility but is not shown: the ✕ is the only dismiss.
export type ConfirmChoice = boolean | "secondary";
export type ConfirmOptions = { title: string; body?: string; points?: string[]; confirm: string; cancel?: string; danger?: boolean; secondary?: string; dismiss?: string; actionsEnd?: boolean };
type Req = ConfirmOptions & { resolve: (ok: ConfirmChoice) => void };
const EVENT = "rolff:confirm";

export function confirmDialog(o: ConfirmOptions): Promise<ConfirmChoice> {
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

function ConfirmView({ req, done }: { req: Req; done: (ok: ConfirmChoice) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const layer = useRef<HTMLDivElement>(null);
  useBackLayer(true, () => done(false));
  useModalLayer(true, layer);
  const backdrop = useBackdropDismiss(() => done(false));
  // Inside a conversation: same place as every other in-chat card, directly under the chat header.
  const underHeader = useUnderChatHeader();
  useEffect(() => {
    // Safe default: focus the ✕ (cancel), never the destructive confirm.
    const x = box.current?.querySelector<HTMLButtonElement>(`button[aria-label="${closeLabel()}"]`);
    x?.focus({ preventScroll: true });
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
    <div className={underHeader !== null ? "overlay confirm-overlay top-overlay" : "overlay confirm-overlay"} ref={layer} style={underHeader !== null ? { paddingTop: underHeader } : undefined} {...backdrop}>
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={req.body && req.points?.length ? "confirm-body confirm-points" : req.body ? "confirm-body" : req.points?.length ? "confirm-points" : undefined} ref={box} onKeyDown={trap}>
        <CardHeader title={req.title} titleId="confirm-title" onClose={() => done(false)} />
        {req.body && <p id="confirm-body">{req.body}</p>}
        {req.points && req.points.length > 0 && <ul className="confirm-points" id="confirm-points">{req.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>}
        <div className={req.actionsEnd ? "confirm-actions end" : "confirm-actions"}>
          {req.dismiss && <button type="button" className="ghost" onClick={() => done(false)}>{req.dismiss}</button>}
          {req.secondary && <button type="button" className="ghost" onClick={() => done("secondary")}>{req.secondary}</button>}
          <button type="button" className={req.danger ? "danger" : undefined} onClick={() => done(true)}>{req.confirm}</button>
        </div>
      </div>
    </div>
  );
}

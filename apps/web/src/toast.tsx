import { useEffect, useRef, useState } from "react";

// Android-SMS-style transient toast: one floating pill above the composer.
// It never takes part in layout, so it cannot shift or scroll the chat.
const EVENT = "rolff:toast";
export const TOAST_MS = 2000;

export type ToastTone = "neutral" | "success";
type ToastDetail = { text: string; tone: ToastTone; ms: number };
/** tone "success" adds a small green check; ms = how long the pill stays (default TOAST_MS). */
export function showToast(text: string, opts: { tone?: ToastTone; ms?: number } = {}): void {
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT, { detail: { text, tone: opts.tone ?? "neutral", ms: opts.ms ?? TOAST_MS } }));
}

/** Distance from the bottom of the visible viewport to just above the composer. */
function bottomOffset(): number {
  const v = window.visualViewport;
  const visibleBottom = v ? v.offsetTop + v.height : window.innerHeight;
  const composer = document.querySelector(".card.composer");
  const top = composer?.getBoundingClientRect().top;
  if (top === undefined || !(top > 0) || top > visibleBottom) return 96;
  return Math.max(16, visibleBottom - top + 12);
}

export function Toast() {
  const [text, setText] = useState("");
  const [tone, setTone] = useState<ToastTone>("neutral");
  const [shown, setShown] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [bottom, setBottom] = useState(96);
  const hide = useRef<number | undefined>(undefined), clear = useRef<number | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      const t = d?.text;
      if (!t) return;
      window.clearTimeout(hide.current); window.clearTimeout(clear.current);
      setBottom(bottomOffset()); setText(t); setTone(d.tone); setShown(true); setNonce(n => n + 1);
      hide.current = window.setTimeout(() => {
        setShown(false);
        clear.current = window.setTimeout(() => setText(""), 250);
      }, d.ms);
    };
    window.addEventListener(EVENT, on);
    return () => { window.removeEventListener(EVENT, on); window.clearTimeout(hide.current); window.clearTimeout(clear.current); };
  }, []);
  // The live region is always mounted so screen readers announce each new text.
  return <div className="toast-region" role="status" aria-live="polite" aria-atomic="true" style={{ bottom }}>
    {text && <div key={nonce} className={`toast-pill${tone === "success" ? " is-success" : ""}${shown ? " is-shown" : ""}`}>{text}</div>}
  </div>;
}

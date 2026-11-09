import { useEffect, useRef, useState } from "react";

// Android-SMS-style transient toast: one floating pill above the composer.
// It never takes part in layout, so it cannot shift or scroll the chat.
const EVENT = "rolff:toast";
export const TOAST_MS = 2000;

export function showToast(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
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
  const [shown, setShown] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [bottom, setBottom] = useState(96);
  const hide = useRef<number | undefined>(undefined), clear = useRef<number | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (!t) return;
      window.clearTimeout(hide.current); window.clearTimeout(clear.current);
      setBottom(bottomOffset()); setText(t); setShown(true); setNonce(n => n + 1);
      hide.current = window.setTimeout(() => {
        setShown(false);
        clear.current = window.setTimeout(() => setText(""), 250);
      }, TOAST_MS);
    };
    window.addEventListener(EVENT, on);
    return () => { window.removeEventListener(EVENT, on); window.clearTimeout(hide.current); window.clearTimeout(clear.current); };
  }, []);
  // The live region is always mounted so screen readers announce each new text.
  return <div className="toast-region" role="status" aria-live="polite" aria-atomic="true" style={{ bottom }}>
    {text && <div key={nonce} className={`toast-pill${shown ? " is-shown" : ""}`}>{text}</div>}
  </div>;
}

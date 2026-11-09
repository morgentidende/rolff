import { useEffect, useId, useRef, useState } from "react";

// Luna: the little floating robot shown while Rolff checks a message.
// Pure inline SVG + CSS (see lunaRobot.css). Purely visual: it never affects sending.
export function LunaRobot({ mood = "checking", size = 60 }: { mood?: "checking" | "happy"; size?: number }) {
  const id = "lr" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg className={`luna-robot luna-robot--${mood}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#f3f7f6" />
          <stop offset="1" stopColor="#dfe9e7" />
        </linearGradient>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#86dcc6" />
          <stop offset="1" stopColor="#3fa98f" />
        </linearGradient>
        <radialGradient id={`${id}s`}>
          <stop offset="0" stopColor="#5fe3c4" stopOpacity=".55" />
          <stop offset="1" stopColor="#5fe3c4" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}c`}><path d="M32 6c-12 0-21 9.5-21 23.5C11 44 19.5 52 32 52s21-8 21-22.5C53 15.5 44 6 32 6Z" /></clipPath>
        <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".9" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse className="lr-shadow" cx="32" cy="59" rx="15" ry="3.2" fill={`url(#${id}s)`} />
      <g className="lr-float">
        <g className="lr-tilt">
          <path className="lr-fin lr-fin-l" d="M11.5 36c-6.5-.5-10-6.5-9-12.5 5 .3 9.5 5.2 9 12.5Z" fill={`url(#${id}m)`} />
          <path className="lr-fin lr-fin-r" d="M52.5 36c6.5-.5 10-6.5 9-12.5-5 .3-9.5 5.2-9 12.5Z" fill={`url(#${id}m)`} />
          <path className="lr-fin lr-fin-l" d="M10.6 34.5c-1.5-3-3.4-5.8-6-8" fill="none" stroke="#e6fbf5" strokeWidth=".9" strokeLinecap="round" opacity=".75" />
          <path className="lr-fin lr-fin-r" d="M53.4 34.5c1.5-3 3.4-5.8 6-8" fill="none" stroke="#e6fbf5" strokeWidth=".9" strokeLinecap="round" opacity=".75" />
          <path className="lr-shell" d="M32 6c-12 0-21 9.5-21 23.5C11 44 19.5 52 32 52s21-8 21-22.5C53 15.5 44 6 32 6Z" fill={`url(#${id}b)`} />
          <g clipPath={`url(#${id}c)`}>
            <path d="M8 40.5c8 3.6 16 4.8 24 4.8s16-1.2 24-4.8V56H8Z" fill={`url(#${id}m)`} />
            <ellipse cx="24.5" cy="13.5" rx="6" ry="3.2" fill="#fff" opacity=".9" transform="rotate(-24 24.5 13.5)" />
          </g>
          <circle cx="52.4" cy="28.5" r="4.4" fill={`url(#${id}m)`} />
          <circle cx="53" cy="28.5" r="2.1" fill="#bfeee2" />
          <rect x="16.5" y="16.5" width="31" height="20.5" rx="10.25" fill="#132423" />
          <g filter={`url(#${id}g)`} fill="#5ff0cf">
            <g className="lr-look"><g className="lr-eyes">
              <ellipse cx="26.5" cy="26.8" rx="2.8" ry="3.6" />
              <ellipse cx="37.5" cy="26.8" rx="2.8" ry="3.6" />
            </g></g>
            <g className="lr-dots">
              <circle className="lr-dot" cx="25" cy="26.8" r="2.2" />
              <circle className="lr-dot" cx="32" cy="26.8" r="2.2" />
              <circle className="lr-dot" cx="39" cy="26.8" r="2.2" />
            </g>
            <g className="lr-joy" fill="none" stroke="#5ff0cf" strokeWidth="1.8" strokeLinecap="round">
              <path d="M23.8 28c.9-2.2 4.5-2.2 5.4 0M34.8 28c.9-2.2 4.5-2.2 5.4 0" />
              <path d="M30 31.4c1.1 1.1 2.9 1.1 4 0" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

const HAPPY_MS = 1100;

// Lives inside the composer surface. While `checking` it shows the robot next to
// the pending message text and a polite live "Tjekker…" label. When a check ends
// with an accepted message it briefly shows the happy robot (visual only).
export function LunaIndicator({ checking, accepted, label, pendingText }: {
  checking: boolean; accepted: boolean; label: string; pendingText?: string;
}) {
  const [happy, setHappy] = useState(false);
  const was = useRef(checking);
  useEffect(() => {
    const ended = was.current && !checking;
    was.current = checking;
    if (checking) { setHappy(false); return; }
    if (!ended || !accepted) { setHappy(false); return; }
    setHappy(true);
    const t = setTimeout(() => setHappy(false), HAPPY_MS);
    return () => clearTimeout(t);
  }, [checking, accepted]);
  if (checking) {
    const body = (pendingText ?? "").replace(/\s+/g, " ").trim();
    return (
      <div className="luna-evaluating luna-in-composer" role="status" aria-live="polite">
        <LunaRobot size={44} />
        <div className="luna-check-copy">
          <span className="luna-check-label">{label}</span>
          {body ? <p className="luna-check-text">{body}</p> : null}
        </div>
      </div>
    );
  }
  if (happy) {
    return (
      <div className="luna-evaluating luna-in-composer luna-done" aria-hidden="true">
        <LunaRobot mood="happy" size={44} />
      </div>
    );
  }
  return null;
}

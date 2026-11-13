import { useLayoutEffect, useRef, useState } from "react";
import { strings, type Lang } from "./i18n";

/** Short context around the first flagged span, so the highlight always fits on one line. */
export function flaggedSnippet(text: string, spans: string[], before = 14, after = 40): { pre: string; hit: string; post: string } | null {
  for (const s of spans) {
    const i = s ? text.indexOf(s) : -1; if (i < 0) continue;
    const a = Math.max(0, i - before), b = Math.min(text.length, i + s.length + after);
    return { pre: (a > 0 ? "…" : "") + text.slice(a, i), hit: s, post: text.slice(i + s.length, b) + (b < text.length ? "…" : "") };
  }
  return null;
}

type Props = { lang: Lang; reason?: string; explanation?: string; spans: string[]; blockedText: string; suggestion: string; onUse: () => void; onClose: () => void };

/** Compact "Ikke sendt" box: header + close, Luna's reason clamped to 2 lines, one flagged line, quoted suggestion chip. */
export function BlockedNotice({ lang, reason, explanation: given, spans, blockedText, suggestion, onUse, onClose }: Props) {
  const t = strings[lang], da = lang === "da";
  // Borderline tone ("uncertain"): Rolff says briefly that the tone is uncertain and asks for a rephrase – fixed text, no extra retry line.
  const uncertain = reason === "uncertain";
  const explanation = uncertain ? t.uncertainExplanation : given;
  const [open, setOpen] = useState(false), [clamped, setClamped] = useState(false);
  const reasonRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = reasonRef.current; if (!el || open) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check(); const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null; ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, explanation]);
  const snip = flaggedSnippet(blockedText, spans);
  const more = clamped || !!suggestion;
  return (
    <div className="notice blockbox" role="alert" aria-labelledby="blockbox-title">
      <div className="blockbox-head">
        <svg className="blockbox-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
        <strong id="blockbox-title">{da ? "Ikke sendt" : "Not sent"}</strong>
        <button type="button" className="blockbox-x" aria-label={da ? "Luk" : "Close"} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p ref={reasonRef} id="blockbox-reason" className={`blockbox-reason${explanation ? " block-explained" : ""}${open ? " open" : ""}`}>
        {explanation ? <><span className="sr-only">{t.blockedLead} </span>{uncertain ? explanation : `${explanation} ${t.blockedRetry}`}</> : t.blocked}
      </p>
      {snip && <p className="blockbox-flag"><span className="blockbox-flag-k">{da ? "Markeret:" : "Flagged:"}</span> <span className="blockbox-flag-v">{snip.pre}<mark>{snip.hit}</mark>{snip.post}</span></p>}
      {suggestion ? (
        <div className="blockbox-sugg">
          <span className="blockbox-sugg-k">{da ? "Forslag" : "Suggestion"}</span>
          <div className={`blockbox-quote${open ? " open" : ""}`}>{suggestion}</div>
          <div className="blockbox-act">
            <button type="button" className="blockbox-use" onClick={onUse}>{t.useSuggestion}</button>
            <span className="blockbox-fine">{da ? "Du kan rette den – det tjekkes igen." : "You can edit it – it’s checked again."}</span>
          </div>
        </div>
      ) : uncertain ? null : <p className="blockbox-guide"><strong>{t.guidanceLabel}:</strong> {t.blockGuidance}</p>}
      {open && suggestion && <p className="blockbox-fine blockbox-long">{da ? "Forslaget kopieres til skrivefeltet, og du skal selv trykke Send. Din egen tekst bliver stående, indtil du vælger forslaget." : "The suggestion is copied into the composer and you press Send yourself. Your own text stays until you use the suggestion."}</p>}
      {more && <button type="button" className="blockbox-more" aria-expanded={open} aria-controls="blockbox-reason" onClick={() => setOpen(!open)}>{open ? (da ? "Mindre" : "Less") : (da ? "Mere" : "More")}</button>}
    </div>
  );
}

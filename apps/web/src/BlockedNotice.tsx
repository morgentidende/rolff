import { useLayoutEffect, useRef, useState } from "react";
import { strings, type Lang } from "./i18n";
import { flaggedSnippet } from "./flaggedSnippet";

export { flaggedSnippet };

export type HouseKind = "profanity" | "exclamation" | "both";
/** Server-sent kind of a house-rule block (swear words / exclamation marks); anything else -> undefined (= conflict-type block). */
export function cleanHouse(raw: unknown): HouseKind | undefined { return raw === "profanity" || raw === "exclamation" || raw === "both" ? raw : undefined; }

type Props = { lang: Lang; reason?: string; house?: HouseKind; explanation?: string; spans: string[]; blockedText: string; suggestion: string; onUse: () => void; onClose: () => void };

/** "Ikke sendt" box: title + close, a short reason (shown in full; "Mere" only when a long explanation is clamped),
 *  the marked text, and a suggestion row with a "Brug forslag" button. House-rule blocks (swear words, "!") never show the generic guidance. */
export function BlockedNotice({ lang, reason, house, explanation: given, spans, blockedText, suggestion, onUse, onClose }: Props) {
  const t = strings[lang], da = lang === "da";
  // Borderline tone ("uncertain"): the detailed explanation (words + role of the earlier conversation) when there is one;
  // otherwise a fixed short Rolff text that already asks for a rephrase (no extra retry line).
  const uncertain = reason === "uncertain" && !house;
  const fixedUncertain = uncertain && (!given || given === strings.da.uncertainExplanation || given === strings.en.uncertainExplanation);
  const explanation = fixedUncertain ? t.uncertainExplanation : given;
  const [open, setOpen] = useState(false), [clamped, setClamped] = useState(false);
  const reasonRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = reasonRef.current; if (!el || open || house) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check(); const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null; ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, explanation, house]);
  const snip = flaggedSnippet(blockedText, spans);
  const more = clamped && !house;
  return (
    <div className={`notice blockbox${house ? " blockbox-house" : ""}`} role="alert" aria-labelledby="blockbox-title">
      <div className="blockbox-head">
        <svg className="blockbox-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
        <strong id="blockbox-title">{da ? "Ikke sendt" : "Not sent"}</strong>
        <button type="button" className="blockbox-x" aria-label={da ? "Luk" : "Close"} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p ref={reasonRef} id="blockbox-reason" className={`blockbox-reason${explanation ? " block-explained" : ""}${open || house ? " open" : ""}`}>
        {explanation ? <><span className="sr-only">{t.blockedLead} </span>{fixedUncertain || house ? explanation : `${explanation} ${t.blockedRetry}`}</> : t.blocked}
      </p>
      {more && <button type="button" className="blockbox-more" aria-expanded={open} aria-controls="blockbox-reason" onClick={() => setOpen(!open)}>{open ? (da ? "Mindre" : "Less") : (da ? "Mere" : "More")}</button>}
      {snip && <p className="blockbox-flag"><span className="blockbox-flag-k">{da ? "Markeret:" : "Flagged:"}</span> <span className="blockbox-flag-v">{snip.pre}<mark>{snip.hit}</mark>{snip.post}</span></p>}
      {suggestion ? (
        <div className="blockbox-sugg">
          <span className="blockbox-sugg-k">{da ? "Forslag" : "Suggestion"}</span>
          <div className="blockbox-quote">{suggestion}</div>
          <button type="button" className="blockbox-use" onClick={onUse}>{t.useSuggestion}</button>
        </div>
      ) : uncertain || house ? null : <p className="blockbox-guide"><strong>{t.guidanceLabel}:</strong> {t.blockGuidance}</p>}
    </div>
  );
}

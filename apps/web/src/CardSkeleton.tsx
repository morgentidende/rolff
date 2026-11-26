import type { Lang } from "./i18n";
/**
 * Placeholder inside a card while its data is loading: the card itself opens at once at (about) its final size, with
 * soft grey bars instead of a tiny "Henter…" card that later jumps to full size. Screen readers hear the status text.
 */
export function CardSkeleton({ lang, label, rows, minHeight }: { lang: Lang; label?: string; rows: (number | "button" | "gap")[]; minHeight?: number }) {
  return <div className="card-skeleton" role="status" aria-busy="true" style={minHeight ? { minHeight } : undefined}>
    <span className="sr-only">{label ?? (lang === "da" ? "Henter…" : "Loading…")}</span>
    {rows.map((r, i) => r === "gap" ? <div key={i} className="sk-gap" aria-hidden="true" />
      : r === "button" ? <div key={i} className="sk-bar sk-button" aria-hidden="true" />
      : <div key={i} className="sk-bar" aria-hidden="true" style={{ width: `${r}%` }} />)}
  </div>;
}

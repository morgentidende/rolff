import type { Lang } from "./i18n";
/** Banner above the composer while a delayed message is being edited (the message is paused on the server). */
export function EditComposer({ lang, onCancel }: { lang: Lang; onCancel: () => void }) {
  const da = lang === "da";
  return (
    <div className="reply-composer" role="status">
      <div className="reply-composer-main">
        <span className="reply-composer-who">{da ? "Retter besked · sat på pause" : "Editing message · paused"}</span>
        <p className="reply-composer-text">{da ? "Send gemmer og starter forfra." : "Send saves and starts over."}</p>
      </div>
      <button type="button" className="reply-composer-close" aria-label={da ? "Annullér rettelse" : "Cancel edit"} onClick={onCancel}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

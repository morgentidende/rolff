import type { Lang } from "./i18n";
/** Banner above the composer while a delayed message is paused: the text lives only in the composer, not as a chat bubble. */
export function EditComposer({ lang, onResume, onDelete }: { lang: Lang; onResume: () => void; onDelete: () => void }) {
  const da = lang === "da";
  return (
    <div className="reply-composer" role="status">
      <div className="reply-composer-main">
        <span className="reply-composer-who">{da ? "Retter besked · sat på pause" : "Editing message · paused"}</span>
        <p className="reply-composer-text">{da ? "Send gemmer og starter forfra." : "Send saves and starts over."}</p>
        <div className="edit-composer-actions">
          <button type="button" className="ghost" onClick={onResume}>{da ? "Genoptag" : "Resume"}</button>
          <button type="button" className="ghost" onClick={onDelete}>{da ? "Slet" : "Delete"}</button>
        </div>
      </div>
    </div>
  );
}

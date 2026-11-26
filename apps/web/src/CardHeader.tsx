import type { Lang } from "./i18n";

/** Accessible label for the shared top-right close control. Falls back to <html lang>. */
export function closeLabel(lang?: Lang | string): string {
  const code = lang ?? (typeof document !== "undefined" ? document.documentElement.lang : "da");
  return code === "en" ? "Close" : "Luk";
}

/** Consistent ✕ close control: top-right of every card, accessible name Luk/Close. */
export function CardClose({ lang, onClick, disabled }: { lang?: Lang | string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="icon card-close" aria-label={closeLabel(lang)} disabled={disabled} onClick={onClick}>✕</button>;
}

/** Shared card title row: title on the left, ✕ on the right. */
export function CardHeader({ title, titleId, lang, onClose, closeDisabled }: {
  title: string; titleId?: string; lang?: Lang | string; onClose: () => void; closeDisabled?: boolean;
}) {
  return (
    <div className="sheethead">
      <h2 id={titleId}>{title}</h2>
      <CardClose lang={lang} onClick={onClose} disabled={closeDisabled} />
    </div>
  );
}

import { useEffect, useRef } from "react";
import { useBackLayer } from "../backNavigation";
import { deniedHelp, openAppSettings, permissionCopy, unsupportedText, type PermissionKind } from "./permissions";
import { deviceOf, isNative, runtime } from "./platform";
type Lang = "da" | "en";
export type PermissionDialogMode = "explain" | "denied" | "unsupported";
/** In-app explanation before a system permission prompt, or how-to-enable help after a "no".
 *  `onAllow` runs inside the button's click, so a following system prompt / input.click()
 *  still counts as a user action. */
export function PermissionDialog({ kind, mode, lang, onAllow, onClose, alternative }: {
  kind: PermissionKind; mode: PermissionDialogMode | null; lang: Lang;
  onAllow: () => void; onClose: () => void; alternative?: { label: string; run: () => void };
}) {
  const ref = useRef<HTMLDialogElement>(null); const open = mode !== null;
  useBackLayer(open, onClose);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { try { d.showModal(); } catch { d.setAttribute("open", ""); } } else if (!open && d.open) d.close(); }, [open]);
  const da = lang === "da"; const copy = permissionCopy(kind, lang); const r = runtime();
  const help = mode === "denied" ? deniedHelp(kind, deviceOf(navigator.userAgent, r), r, lang) : null;
  const title = mode === "explain" ? copy.title : mode === "denied" ? help!.title : (da ? "Ikke muligt her" : "Not available here");
  return <dialog ref={ref} className="composer-upgrade permission-dialog" aria-labelledby={`perm-${kind}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    {open && <>
      <h3 id={`perm-${kind}`}>{title}</h3>
      {mode === "explain" && <p>{copy.body}</p>}
      {mode === "denied" && <><p>{da ? "Du har tidligere sagt nej. Sådan slår du det til igen:" : "You said no earlier. To turn it back on:"}</p><ol className="permission-steps">{help!.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>}
      {mode === "unsupported" && <p>{unsupportedText(kind, lang)}</p>}
      <div className="row end">
        {alternative && mode !== "explain" && <button type="button" className="ghost" onClick={() => { onClose(); alternative.run(); }}>{alternative.label}</button>}
        {mode === "explain"
          ? <><button type="button" className="ghost" onClick={onClose}>{copy.later}</button><button type="button" onClick={() => { onClose(); onAllow(); }}>{copy.allow}</button></>
          : <>{mode === "denied" && isNative() && <button type="button" className="ghost" onClick={() => void openAppSettings()}>{da ? "Åbn indstillinger" : "Open settings"}</button>}<button type="button" onClick={onClose}>{da ? "OK" : "OK"}</button></>}
      </div>
    </>}
  </dialog>;
}

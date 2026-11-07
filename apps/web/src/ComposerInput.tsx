import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { messageCharCount } from "./composerLimits";

export const FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
type Props = {
  lang: "da" | "en"; text: string; onText: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>; plan: string | null; cap: number;
  busy: boolean; file: File | null; onFile: (file: File | null) => void;
  onSend: () => void; openPlans: () => void; canSend: boolean; retry?: boolean;
};
const Glyph = ({ children }: { children: React.ReactNode }) => <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export function ComposerInput({ lang, text, onText, textareaRef, plan, cap, busy, file, onFile, onSend, openPlans, canSend, retry = false }: Props) {
  const da = lang === "da"; const count = messageCharCount(text);
  const picker = useRef<HTMLInputElement>(null); const camera = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null); const [upgrade, setUpgrade] = useState(false); const [note, setNote] = useState("");
  useLayoutEffect(() => {
    const el = textareaRef.current; if (!el) return;
    const grow = () => { el.style.height = "0px"; const height = Math.min(el.scrollHeight, 180); el.style.height = `${height}px`; el.style.overflowY = el.scrollHeight > height ? "auto" : "hidden"; };
    grow(); let width = el.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { const next = el.getBoundingClientRect().width; if (next !== width) { width = next; grow(); } });
    observer?.observe(el); window.addEventListener("resize", grow);
    return () => { observer?.disconnect(); window.removeEventListener("resize", grow); };
  }, [text, textareaRef]);
  useEffect(() => { if (upgrade && !dialog.current?.open) dialog.current?.showModal(); else if (!upgrade && dialog.current?.open) dialog.current.close(); }, [upgrade]);
  const choose = (kind: "file" | "camera") => {
    if (busy) return; setNote("");
    if (plan !== "text_attachments") { setUpgrade(true); return; }
    const input = kind === "camera" ? camera.current : picker.current;
    if (!input) return; input.value = "";
    try { input.click(); } catch { setNote(da ? "Kunne ikke åbne vælgeren. Prøv igen, eller vælg et billede via papirclipsen." : "Could not open the picker. Try again or choose a photo with the paperclip."); }
  };
  const selected = (input: HTMLInputElement) => {
    const next = input.files?.[0]; if (!next) return;
    onFile(null); // An invalid new selection must never accidentally send an older file.
    if (next.size > MAX_ATTACHMENT_BYTES) { setNote(da ? "Filen er for stor (højst 4 MB). Vælg en mindre fil." : "The file is too large (max 4 MB). Choose a smaller file."); return; }
    if (next.size === 0) { setNote(da ? "Filen er tom. Vælg en anden fil." : "The file is empty. Choose another file."); return; }
    setNote(""); onFile(next);
  };
  useEffect(() => {
    const canceled = () => setNote(da ? "Ingen fil valgt. Hvis kameraet ikke åbner, kan du vælge et billede via papirclipsen." : "No file selected. If the camera does not open, choose a photo with the paperclip.");
    const inputs = [picker.current, camera.current]; inputs.forEach(el => el?.addEventListener("cancel", canceled));
    return () => inputs.forEach(el => el?.removeEventListener("cancel", canceled));
  }, [da]);
  return <>
    <div className="composer-input-row">
      <button type="button" className="composer-icon" disabled={busy || plan === null} aria-label={da ? "Vedhæft fil" : "Attach file"} title={da ? "Vedhæft fil" : "Attach file"} onClick={() => choose("file")}><Glyph><path d="m21 11-8.2 8.2a5.3 5.3 0 0 1-7.5-7.5l9-9a3.5 3.5 0 0 1 5 5l-9 9a1.8 1.8 0 0 1-2.5-2.5l8.3-8.3" /></Glyph></button>
      <button type="button" className="composer-icon" disabled={busy || plan === null} aria-label={da ? "Tag billede" : "Take photo"} title={da ? "Tag billede" : "Take photo"} onClick={() => choose("camera")}><Glyph><path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /></Glyph></button>
      <textarea className="message-input" ref={textareaRef} rows={1} value={text} disabled={busy} aria-label={da ? "Skriv en besked" : "Write a message"} aria-describedby="composer-count" aria-invalid={(count > cap && !retry) || undefined} placeholder={da ? "Skriv en besked" : "Write a message"} onChange={e => onText(e.target.value)} />
      <button type="button" className="composer-send" aria-label={busy ? (da ? "Sender" : "Sending") : file ? (da ? "Send vedhæftning" : "Send attachment") : (da ? "Send besked" : "Send message")} title={da ? "Send" : "Send"} disabled={busy || !canSend || (count > cap && !retry) || plan === null} onClick={onSend}><Glyph><path d="m22 2-7 20-4-9-9-4Z" /><path d="m22 2-11 11" /></Glyph></button>
    </div>
    <input type="file" ref={picker} accept={FILE_ACCEPT} hidden disabled={busy} onChange={e => selected(e.currentTarget)} />
    <input type="file" ref={camera} accept="image/*" capture="environment" hidden disabled={busy} onChange={e => selected(e.currentTarget)} />
    <div id="composer-count" className={`composer-count meta${count > cap ? " over-limit" : ""}`} role="status">{count}/{cap}{count > cap ? (retry ? (da ? " – prøv den tidligere afsendelse igen" : " – retry the previous send") : (da ? " – forkort beskeden for at sende" : " – shorten your message to send")) : ""}</div>
    {note && <p className="meta" role="status">{note}</p>}
    <dialog className="composer-upgrade" ref={dialog} aria-labelledby="upgrade-title" onCancel={() => setUpgrade(false)} onClose={() => setUpgrade(false)} onClick={e => { if (e.target === e.currentTarget) setUpgrade(false); }}>
      <h3 id="upgrade-title">{da ? "Vil du dele billeder og filer?" : "Would you like to share photos and files?"}</h3>
      <p>{da ? "Med planen til 79 kr./md. kan du bruge kameraet, sende vedhæftninger og skrive op til 480 tegn pr. besked." : "With the 79 DKK/month plan you can use the camera, send attachments and write up to 480 characters per message."}</p>
      <div className="row end"><button type="button" className="ghost" onClick={() => setUpgrade(false)}>{da ? "Måske senere" : "Maybe later"}</button><button type="button" onClick={() => { setUpgrade(false); openPlans(); }}>{da ? "Se planen til 79 kr." : "See the 79 DKK plan"}</button></div>
    </dialog>
  </>;
}

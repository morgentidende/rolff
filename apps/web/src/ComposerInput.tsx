import { useBackLayer } from "./backNavigation";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { messageCharCount } from "./composerLimits";
import { fileIsBlockedType, pickerAccept, recipientAttachHint, type RecipientAttachmentBlocks } from "./attachmentBlocks";
import { PermissionDialog, type PermissionDialogMode } from "./native/PermissionDialog";
import { markExplained, nextStep, queryPermission, wasExplained, type PermissionKind, type PermissionState } from "./native/permissions";
import { runtime } from "./native/platform";

export const FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
// The character counter only shows (as a small floating pill, no extra row) from 80 % of the limit.
export const COUNT_SHOW_AT = 0.8;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
type Props = {
  lang: "da" | "en"; text: string; onText: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>; plan: string | null; cap: number;
  busy: boolean; file: File | null; onFile: (file: File | null) => void;
  onSend: () => void; openPlans: () => void; canSend: boolean; retry?: boolean;
  leading?: React.ReactNode;
  /** Luna checking/happy row rendered inside the composer surface. */
  statusSlot?: React.ReactNode;
  recipientBlocks?: RecipientAttachmentBlocks;
  /** ISO time when a delayed own message becomes due. Shows countdown + send-now on the button. */
  countdownUntil?: string | null;
  onSendNow?: () => void;
};
const Glyph = ({ children }: { children: React.ReactNode }) => <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const RING_R = 21.5;
const RING_C = 2 * Math.PI * RING_R;
function SendCountdown({ sec, frac }: { sec: number; frac: number }) {
  return (
    <span className="send-now-face">
      <svg className="send-now-ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle className="send-now-ring-track" cx="24" cy="24" r={RING_R} fill="none" />
        <circle className="send-now-ring-value" cx="24" cy="24" r={RING_R} fill="none"
          strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)} transform="rotate(-90 24 24)" />
      </svg>
      <span className="send-now-stack">
        <Glyph><path d="m22 2-7 20-4-9-9-4Z" /><path d="m22 2-11 11" /></Glyph>
        <span className="send-now-count">{sec}</span>
      </span>
    </span>
  );
}

export function ComposerInput({ lang, text, onText, textareaRef, plan, cap, busy, file, onFile, onSend, openPlans, canSend, retry = false, leading, statusSlot, recipientBlocks = { photos: false, files: false }, countdownUntil = null, onSendNow }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!countdownUntil || canSend || busy) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [countdownUntil, canSend, busy]);
  const remainMs = countdownUntil && !canSend && !busy ? Math.max(0, Date.parse(countdownUntil) - now) : 0;
  const counting = !!countdownUntil && !canSend && !busy && remainMs > 0;
  const countSec = counting ? Math.max(1, Math.ceil(remainMs / 1000)) : 0;
  const ringFrac = counting ? Math.max(0, Math.min(1, remainMs / 30000)) : 0;
  const da = lang === "da"; const count = messageCharCount(text);
  const accept = pickerAccept(recipientBlocks); const showPaperclip = accept !== null; const showCamera = !recipientBlocks.photos;
  const attachHint = recipientAttachHint(lang, recipientBlocks);
  const paperclipLabel = !showPaperclip ? "" : recipientBlocks.photos ? (da ? "Vedhæft fil (PDF)" : "Attach file (PDF)") : recipientBlocks.files ? (da ? "Vedhæft billede" : "Attach photo") : (da ? "Vedhæft fil" : "Attach file");
  const picker = useRef<HTMLInputElement>(null); const camera = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null); const [upgrade, setUpgrade] = useState(false); const [note, setNote] = useState("");
  useBackLayer(upgrade,()=>setUpgrade(false));
  useLayoutEffect(() => {
    const el = textareaRef.current; if (!el) return;
    const grow = () => { el.style.height = "0px"; const height = Math.min(el.scrollHeight, 180); el.style.height = `${height}px`; el.style.overflowY = el.scrollHeight > height ? "auto" : "hidden"; };
    grow(); let width = el.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { const next = el.getBoundingClientRect().width; if (next !== width) { width = next; grow(); } });
    observer?.observe(el); window.addEventListener("resize", grow);
    return () => { observer?.disconnect(); window.removeEventListener("resize", grow); };
  }, [text, textareaRef]);
  useEffect(() => { if (upgrade && !dialog.current?.open) dialog.current?.showModal(); else if (!upgrade && dialog.current?.open) dialog.current.close(); }, [upgrade]);
  // Permission state is read ahead of time (never prompts), so a tap can open the
  // picker synchronously – the picker must open inside the user's own tap.
  const [perm, setPerm] = useState<Record<"camera" | "files", PermissionState>>({ camera: "prompt", files: "prompt" });
  const [ask, setAsk] = useState<{ kind: PermissionKind; mode: PermissionDialogMode } | null>(null);
  useEffect(() => {
    if (plan !== "text_attachments") return; let live = true;
    const read = () => void Promise.all([queryPermission("camera"), queryPermission("files")]).then(([camera, files]) => { if (live) setPerm({ camera, files }); }).catch(() => {});
    read(); window.addEventListener("focus", read); document.addEventListener("visibilitychange", read);
    return () => { live = false; window.removeEventListener("focus", read); document.removeEventListener("visibilitychange", read); };
  }, [plan]);
  const choose = (kind: "file" | "camera") => {
    if (busy) return; setNote("");
    if (plan !== "text_attachments") { setUpgrade(true); return; }
    const k: "camera" | "files" = kind === "camera" ? "camera" : "files";
    const step = nextStep(k, perm[k], wasExplained(k), runtime());
    if (step === "open") openInput(kind); else setAsk({ kind: k, mode: step });
  };
  const openInput = (kind: "file" | "camera") => {
    const input = kind === "camera" ? camera.current : picker.current;
    if (!input) return; input.value = "";
    try { input.click(); } catch { setNote(da ? "Kunne ikke åbne vælgeren. Prøv igen, eller vælg et billede via papirclipsen." : "Could not open the picker. Try again or choose a photo with the paperclip."); }
  };
  const selected = (input: HTMLInputElement) => {
    const next = input.files?.[0]; if (!next) return;
    onFile(null); // An invalid new selection must never accidentally send an older file.
    if (next.size > MAX_ATTACHMENT_BYTES) { setNote(da ? "Filen er for stor (højst 4 MB). Vælg en mindre fil." : "The file is too large (max 4 MB). Choose a smaller file."); return; }
    if (next.size === 0) { setNote(da ? "Filen er tom. Vælg en anden fil." : "The file is empty. Choose another file."); return; }
    const blocked = fileIsBlockedType(next, recipientBlocks);
    if (blocked) { setNote(blocked === "photos" ? (da ? "Modtageren tager ikke imod fotos i denne samtale." : "The recipient does not accept photos in this conversation.") : (da ? "Modtageren tager ikke imod filer i denne samtale." : "The recipient does not accept files in this conversation.")); return; }
    setNote(""); onFile(next);
  };
  useEffect(() => {
    if (!file) return;
    const blocked = fileIsBlockedType(file, recipientBlocks);
    if (blocked) { onFile(null); setNote(blocked === "photos" ? (da ? "Modtageren tager ikke imod fotos i denne samtale." : "The recipient does not accept photos in this conversation.") : (da ? "Modtageren tager ikke imod filer i denne samtale." : "The recipient does not accept files in this conversation.")); }
  }, [file, recipientBlocks.photos, recipientBlocks.files, da, onFile]);
  useEffect(() => {
    const canceled = () => setNote(da ? "Ingen fil valgt. Hvis kameraet ikke åbner, kan du vælge et billede via papirclipsen." : "No file selected. If the camera does not open, choose a photo with the paperclip.");
    const inputs = [picker.current, camera.current]; inputs.forEach(el => el?.addEventListener("cancel", canceled));
    return () => inputs.forEach(el => el?.removeEventListener("cancel", canceled));
  }, [da]);
  return <>
    <div className="composer-input-row">
      <div className={`composer-entry${leading && !busy ? " has-reply" : ""}${statusSlot ? " has-luna" : ""}${busy ? " is-checking" : ""}`}>
      {statusSlot}
      {!busy && leading}
      <div className="composer-entry-row" hidden={busy || undefined} aria-hidden={busy || undefined}>
      {showPaperclip && <button type="button" className="composer-icon" disabled={busy || plan === null} aria-label={paperclipLabel} title={paperclipLabel} onClick={() => choose("file")}><Glyph><path d="m21 11-8.2 8.2a5.3 5.3 0 0 1-7.5-7.5l9-9a3.5 3.5 0 0 1 5 5l-9 9a1.8 1.8 0 0 1-2.5-2.5l8.3-8.3" /></Glyph></button>}
      <textarea className="message-input" ref={textareaRef} rows={1} value={text} disabled={busy} aria-label={da ? "Skriv en besked" : "Write a message"} aria-describedby="composer-count" aria-invalid={(count > cap && !retry) || undefined} placeholder={da ? "Skriv en besked" : "Write a message"} onChange={e => onText(e.target.value)} />
      {showCamera && <button type="button" className="composer-icon" disabled={busy || plan === null} aria-label={da ? "Tag billede" : "Take photo"} title={da ? "Tag billede" : "Take photo"} onClick={() => choose("camera")}><Glyph><path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /></Glyph></button>}
      </div>
      </div>
      <button type="button" className={`composer-send${counting ? " is-countdown" : ""}`} aria-busy={busy || undefined} aria-label={busy ? (da ? "Sender" : "Sending") : counting ? (da ? `Send nu (${countSec} s)` : `Send now (${countSec} s)`) : file ? (da ? "Send vedhæftning" : "Send attachment") : (da ? "Send besked" : "Send message")} title={counting ? (da ? `Send nu (${countSec} s)` : `Send now (${countSec} s)`) : (da ? "Send" : "Send")} disabled={busy || (!counting && (!canSend || (count > cap && !retry) || plan === null))} onClick={counting ? onSendNow : onSend}>{busy ? <span className="send-spinner" aria-hidden="true" /> : counting ? <SendCountdown sec={countSec} frac={ringFrac} /> : <Glyph><path d="m22 2-7 20-4-9-9-4Z" /><path d="m22 2-11 11" /></Glyph>}</button>
    </div>
    {showPaperclip && <input type="file" ref={picker} accept={accept ?? FILE_ACCEPT} hidden disabled={busy} onChange={e => selected(e.currentTarget)} />}
    {showCamera && <input type="file" ref={camera} accept="image/*" capture="environment" hidden disabled={busy} onChange={e => selected(e.currentTarget)} />}
    <div id="composer-count" className={`composer-count meta${count > cap ? " over-limit" : ""}${count >= Math.ceil(cap * COUNT_SHOW_AT) ? "" : " is-quiet"}`} role="status">{count}/{cap}{count > cap ? (retry ? (da ? " – prøv den tidligere afsendelse igen" : " – retry the previous send") : (da ? " – forkort beskeden for at sende" : " – shorten your message to send")) : ""}</div>
    {note && <p className="meta" role="status">{note}</p>}
    {attachHint && <p className="meta" role="status">{attachHint}</p>}
    {ask && <PermissionDialog kind={ask.kind} mode={ask.mode} lang={lang} onClose={() => setAsk(null)}
      onAllow={() => { markExplained(ask.kind); openInput(ask.kind === "camera" ? "camera" : "file"); }}
      alternative={ask.kind === "camera" && showPaperclip && !recipientBlocks.photos ? { label: da ? "Vælg billede i stedet" : "Choose a photo instead", run: () => choose("file") } : undefined} />}
    <dialog className="composer-upgrade" ref={dialog} aria-labelledby="upgrade-title" onCancel={e => { e.preventDefault(); setUpgrade(false); }} onClick={e => { if (e.target === e.currentTarget) setUpgrade(false); }}>
      <h3 id="upgrade-title">{da ? "Vil du dele billeder og filer?" : "Would you like to share photos and files?"}</h3>
      <p>{da ? "Med planen til 79 kr./md. kan du bruge kameraet, sende vedhæftninger og skrive op til 480 tegn pr. besked." : "With the 79 DKK/month plan you can use the camera, send attachments and write up to 480 characters per message."}</p>
      <div className="row end"><button type="button" className="ghost" onClick={() => setUpgrade(false)}>{da ? "Måske senere" : "Maybe later"}</button><button type="button" onClick={() => { setUpgrade(false); openPlans(); }}>{da ? "Se planen til 79 kr." : "See the 79 DKK plan"}</button></div>
    </dialog>
  </>;
}

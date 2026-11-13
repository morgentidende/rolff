// "Udskrift af samtale": requested here, built and signed on the SERVER (export-conversation) and
// e-mailed. Nothing is generated or downloaded on the device. 79 DKK plan only (enforced server-side).
import { useCallback, useEffect, useRef, useState } from "react";
import { callFn, supabase } from "./supabase";
import { focusField } from "./formHint";

export type ExportCall = (name: string, body: unknown) => Promise<{ status: number; data: any }>;
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
export const validRecipient = (s: string) => s.trim().length <= 254 && EMAIL.test(s.trim());
// Local calendar date (YYYY-MM-DD) n days before today, in the device's own zone.
export const localDay = (daysAgo = 0, now = new Date()) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export type PeriodIssue = "" | "empty" | "order" | "future";
export const periodIssue = (from: string, to: string, today = localDay()): PeriodIssue =>
  !from && !to ? "empty" : from && to && from > to ? "order" : (from > today || to > today) ? "future" : "";
const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Copenhagen"; } catch { return "Europe/Copenhagen"; } };

export type PlanLoader = () => Promise<string>;
export const PLAN_TIMEOUT_MS = 10000;
// Reads the caller's effective plan. Rejects on any RPC error or empty answer so the sheet can
// show a clear error instead of waiting forever.
export const fetchMyPlan: PlanLoader = async () => {
  const { data, error } = await supabase.rpc("get_my_plan");
  if (error) throw new Error(error.code || "plan_error");
  const plan = (data as { plan?: string }[] | null)?.[0]?.plan;
  if (typeof plan !== "string" || !plan) throw new Error("plan_empty");
  return plan;
};
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function ExportUpgrade({ lang, openPlans, close }: { lang: string; openPlans: () => void; close?: () => void }) {
  const da = lang === "da";
  return <div className="composer-upgrade export-upgrade" role="region" aria-labelledby="export-upgrade-title">
    <h3 id="export-upgrade-title">{da ? "Vil du have en udskrift til advokat eller myndighed?" : "Need a transcript for a lawyer or authority?"}</h3>
    <p>{da ? "Med planen til 79 kr./md. kan du få en signeret udskrift af samtalen sendt på e-mail – til dig selv eller fx din advokat. Udskriften kan kontrolleres for ægthed." : "With the 79 DKK/month plan you can have a signed transcript of the conversation e-mailed to yourself or e.g. your lawyer. Its authenticity can be checked."}</p>
    <div className="row end">{close && <button type="button" className="ghost" onClick={close}>{da ? "Måske senere" : "Maybe later"}</button>}<button type="button" onClick={openPlans}>{da ? "Se planen til 79 kr." : "See the 79 DKK plan"}</button></div>
  </div>;
}

const ERR: Record<string, [string, string]> = {
  plan_required: ["Udskrift kræver planen Tekst + vedhæftninger (79 kr./md.).", "Transcripts require the Text + attachments plan."],
  rate_limited: ["Du har lavet mange udskrifter. Prøv igen senere (højst 3 i timen og 10 i døgnet, heraf 5 til andre).", "Too many transcripts. Try again later."],
  bad_email: ["Tjek e-mailadressen.", "Check the email address."],
  bad_period: ["Tjek perioden: Fra-datoen skal ligge før til-datoen.", "Check the period."],
  mail_failed: ["Udskriften kunne ikke sendes. Prøv igen senere.", "The transcript could not be sent. Try again later."],
  signing_unavailable: ["Udskrifter er midlertidigt ikke tilgængelige.", "Transcripts are temporarily unavailable."],
};

export function ConversationExport({ lang, conv, plan: planProp, ownEmail, openPlans, call = callFn, loadPlan = fetchMyPlan, onPlan, timeoutMs = PLAN_TIMEOUT_MS }: { lang: string; conv: string; plan: string | null; ownEmail: string; openPlans: () => void; call?: ExportCall; loadPlan?: PlanLoader; onPlan?: (plan: string) => void; timeoutMs?: number }) {
  const da = lang === "da";
  // The sheet must always resolve: it never waits on the chat's one-shot plan load. If the plan is
  // not known yet it asks for it itself, with a timeout, and shows an error with a retry.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [planState, setPlanState] = useState<"idle" | "loading" | "error">(planProp ? "idle" : "loading");
  const attempt = useRef(0);
  const fetchPlan = useCallback(() => {
    const id = ++attempt.current; setPlanState("loading");
    let p: Promise<string>; try { p = loadPlan(); } catch (e) { p = Promise.reject(e); }
    withTimeout(p, timeoutMs).then((v) => { if (id !== attempt.current) return; setLoaded(v); setPlanState("idle"); onPlan?.(v); },
      () => { if (id !== attempt.current) return; setPlanState("error"); });
  }, [loadPlan, timeoutMs, onPlan]);
  useEffect(() => { if (!planProp) fetchPlan(); return () => { attempt.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = planProp ?? loaded;
  const today = localDay();
  const [scope, setScope] = useState<"all" | "period">("all"); const [from, setFrom] = useState(() => localDay(30)); const [to, setTo] = useState(today);
  const [who, setWho] = useState<"self" | "other">("self"); const [other, setOther] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "done">("form"); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Explained-disabled: "Fortsæt" stays tappable and says what is missing next to the field.
  const [nudge, setNudge] = useState<{ period: boolean; email: boolean }>({ period: false, email: false });
  const [emailTouched, setEmailTouched] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null); const emailRef = useRef<HTMLInputElement>(null);
  if (plan === null && planState === "error") return <div className="export-load-error">
    <p className="field-hint" role="alert">{da ? "Udskriften kunne ikke hentes lige nu. Tjek din internetforbindelse og prøv igen." : "The transcript could not be loaded right now. Check your internet connection and try again."}</p>
    <div className="export-retry"><button type="button" onClick={fetchPlan}>{da ? "Prøv igen" : "Try again"}</button></div>
  </div>;
  if (plan === null) return <p className="meta" role="status">{da ? "Henter…" : "Loading…"}</p>;
  if (plan !== "text_attachments") return <ExportUpgrade lang={lang} openPlans={openPlans} />;
  const recipient = who === "self" ? ownEmail : other.trim().toLowerCase();
  const pIssue: PeriodIssue = scope === "all" ? "" : periodIssue(from, to, today);
  const emailOk = who === "self" || validRecipient(other);
  const canNext = emailOk && !pIssue;
  const preset = (days: number) => { setScope("period"); setFrom(localDay(days)); setTo(today); setNudge((n) => ({ ...n, period: false })); };
  const presetOn = (days: number) => scope === "period" && from === localDay(days) && to === today;
  const periodText: Record<Exclude<PeriodIssue, "">, [string, string]> = {
    empty: ["Vælg en periode.", "Choose a period."],
    order: ["Fra-datoen skal være før Til-datoen.", "The From date must be before the To date."],
    future: ["Vælg en dato, der ikke ligger i fremtiden.", "Choose a date that is not in the future."],
  };
  const scopeText = scope === "all" ? (da ? "Hele samtalen" : "Whole conversation") : `${da ? "Udsnit" : "Excerpt"}: ${from || (da ? "start" : "start")} – ${to || (da ? "nu" : "now")}`;
  const send = async () => {
    setBusy(true); setMsg(null);
    let r; try { r = await call("export-conversation", { conversation_id: conv, recipient: who, email: who === "other" ? recipient : null, from: scope === "period" ? from || null : null, to: scope === "period" ? to || null : null, time_zone: deviceZone(), confirm: true, lang }); } catch { r = { status: 0, data: null }; }
    setBusy(false);
    if (r.status === 200) { setStep("done"); setMsg({ ok: true, text: da ? `Udskriften er sendt til ${r.data?.data?.recipient ?? recipient}. Verifikationskode: ${r.data?.data?.verify_code ?? ""}` : `The transcript was sent to ${r.data?.data?.recipient ?? recipient}.` }); }
    else { const e = ERR[r.data?.error as string]; setMsg({ ok: false, text: e ? e[da ? 0 : 1] : (da ? "Udskriften kunne ikke laves. Prøv igen." : "The transcript could not be created.") }); if (r.data?.error === "plan_required") openPlans(); }
  };
  if (step === "done") return <div><p className="notice" role="status">{msg?.text}</p><p className="meta">{da ? "Udskriften er ikke gemt på din telefon. Den anden part kan se i samtalen, at der er lavet en udskrift." : "Nothing is stored on your phone. The other party can see in the conversation that a transcript was made."}</p></div>;
  if (step === "confirm") return <div className="export-confirm">
    <p><strong>{da ? "Udskriften sendes til:" : "The transcript will be sent to:"}</strong><br /><span className="export-recipient">{recipient}</span></p>
    <p className="meta">{scopeText}. {da ? "PDF'en laves og signeres på Rolffs server og sendes kun som e-mail. Den anden part kan se i samtalen, at du har lavet en udskrift." : "The PDF is created and signed on Rolff's server and only sent by e-mail. The other party can see that you made a transcript."}{who === "other" ? (da ? " Du får en kvittering på din egen e-mail." : " You get a receipt on your own e-mail.") : ""}</p>
    {msg && <p className="err" role="alert">{msg.text}</p>}
    <div className="dialog-actions"><button type="button" className="ghost" disabled={busy} onClick={() => setStep("form")}>{da ? "Tilbage" : "Back"}</button><button type="button" disabled={busy} onClick={send}>{busy ? (da ? "Sender…" : "Sending…") : (da ? "Send udskrift" : "Send transcript")}</button></div>
  </div>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canNext) { setStep("confirm"); return; }
    setNudge({ period: !!pIssue, email: !emailOk });
    focusField(pIssue ? fromRef.current : emailRef.current);
  };
  const showPeriodHint = !!pIssue && (nudge.period || pIssue === "order" || pIssue === "future");
  const showEmailHint = who === "other" && !emailOk && (nudge.email || (emailTouched && other.trim() !== ""));
  return <form className="export-form" noValidate onSubmit={submit}>
    <p className="export-lead">{da ? "Signeret PDF sendt på e-mail. Ægtheden kan tjekkes på siden “Tjek udskrift”." : "A signed PDF sent by e-mail. Authenticity can be checked on the “Verify transcript” page."}</p>
    <details className="more export-more"><summary>{da ? "Mere om udskriften" : "More about the transcript"}</summary>
      <p>{da ? "Den indeholder kun beskeder, du selv har adgang til, med tidspunkter og besked-ID'er. PDF'en laves og signeres på Rolffs server og gemmes ikke på din telefon. Den anden part kan se i samtalen, at der er lavet en udskrift." : "It only contains messages you can access, with timestamps and message IDs. The PDF is created and signed on Rolff's server and is not stored on your phone. The other party can see in the conversation that a transcript was made."}</p>
    </details>
    <fieldset className="export-fieldset"><legend>{da ? "Hvad skal med?" : "What to include?"}</legend>
      <div className="choices">
        <label className="choice"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} /><span className="choice-text"><span className="choice-title">{da ? "Hele samtalen" : "Whole conversation"}</span></span></label>
        <label className="choice"><input type="radio" name="scope" checked={scope === "period"} onChange={() => setScope("period")} /><span className="choice-text"><span className="choice-title">{da ? "Vælg periode" : "Choose period"}</span></span></label>
      </div>
      {scope === "period" && <div className="export-period">
        <div className="export-presets" role="group" aria-label={da ? "Hurtigvalg" : "Quick picks"}>
          <button type="button" className={`chip-btn${presetOn(7) ? " on" : ""}`} aria-pressed={presetOn(7)} onClick={() => preset(7)}>{da ? "Seneste 7 dage" : "Last 7 days"}</button>
          <button type="button" className={`chip-btn${presetOn(30) ? " on" : ""}`} aria-pressed={presetOn(30)} onClick={() => preset(30)}>{da ? "Seneste 30 dage" : "Last 30 days"}</button>
        </div>
        <div className="export-dates">
          <label htmlFor="export-from">{da ? "Fra" : "From"}<input ref={fromRef} id="export-from" name="export-from" type="date" max={to || today} value={from} aria-invalid={showPeriodHint || undefined} aria-describedby={showPeriodHint ? "export-period-hint" : undefined} onChange={(e) => { setFrom(e.target.value); setNudge((n) => ({ ...n, period: false })); }} /></label>
          <label htmlFor="export-to">{da ? "Til" : "To"}<input id="export-to" name="export-to" type="date" min={from || undefined} max={today} value={to} aria-invalid={showPeriodHint || undefined} aria-describedby={showPeriodHint ? "export-period-hint" : undefined} onChange={(e) => { setTo(e.target.value); setNudge((n) => ({ ...n, period: false })); }} /></label>
        </div>
        {showPeriodHint && pIssue && <p id="export-period-hint" className="field-hint" role="alert">{periodText[pIssue][da ? 0 : 1]}</p>}
      </div>}
    </fieldset>
    <fieldset className="export-fieldset"><legend>{da ? "Hvem skal have den?" : "Who should receive it?"}</legend>
      <div className="choices">
        <label className="choice"><input type="radio" name="who" checked={who === "self"} onChange={() => setWho("self")} /><span className="choice-text"><span className="choice-title">{da ? "Min e-mail" : "My email"}</span><span className="choice-sub" title={ownEmail}>{ownEmail}</span></span></label>
        <label className="choice"><input type="radio" name="who" checked={who === "other"} onChange={() => { setWho("other"); setTimeout(() => emailRef.current?.focus(), 0); }} /><span className="choice-text"><span className="choice-title">{da ? "En anden e-mail" : "Another email"}</span><span className="choice-sub">{da ? "Fx din advokat" : "E.g. your lawyer"}</span></span></label>
      </div>
      {who === "other" && <div className="export-email-wrap"><label htmlFor="export-email">{da ? "Modtagerens e-mail" : "Recipient's email"}</label><input ref={emailRef} id="export-email" name="recipient-email" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" maxLength={254} placeholder={da ? "navn@advokat.dk" : "name@example.com"} value={other} aria-invalid={showEmailHint || undefined} aria-describedby={showEmailHint ? "export-email-hint" : undefined} onBlur={() => setEmailTouched(true)} onChange={(e) => { setOther(e.target.value); setNudge((n) => ({ ...n, email: false })); }} />
        {showEmailHint && <p id="export-email-hint" className="field-hint" role="alert">{other.trim() ? (da ? "Tjek e-mailadressen – den ser ikke gyldig ud." : "Check the email address – it doesn't look valid.") : (da ? "Skriv en gyldig e-mail." : "Enter a valid email.")}</p>}</div>}
    </fieldset>
    <div className="export-actions"><button type="submit" aria-disabled={!canNext || undefined}>{da ? "Fortsæt" : "Continue"}</button></div>
  </form>;
}

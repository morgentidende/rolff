import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { codeFromUrl, describe, normalizeCode, sha256File, verifyExport, type VerifyLang, type VerifyResult } from "./verifyExport";
import { detectLang } from "./i18n";
import "./styles.css";
import "./verify.css";

const T = {
  da: {
    title: "Tjek udskrift",
    docTitle: "Tjek udskrift – Rolff",
    intro: "Her kan du kontrollere, om en PDF-udskrift af en samtale fra Rolff er ægte og uændret. ",
    notSent: "Filen bliver ikke sendt.",
    intro2: " Din enhed beregner kun filens fingeraftryk (SHA-256), som sammenlignes med Rolffs register. Siden viser aldrig beskedernes indhold.",
    file: "1. Vælg PDF-filen fra e-mailen",
    pick: "Vælg PDF-fil",
    noFile: "Ingen fil valgt",
    fingerprint: (name: string) => `Fingeraftryk af ${name}: `,
    code: "2. Kode fra bunden af siderne (valgfri, hvis du har valgt filen)",
    checking: "Tjekker…",
    check: "Tjek udskrift",
    rate: "Du har tjekket mange gange. Vent 10 minutter og prøv igen.",
    failed: "Kontrollen kunne ikke gennemføres. Prøv igen.",
    foot: "Rolff kan ikke vurdere, hvordan en domstol eller myndighed vil bruge udskriften. Testversion.",
    lang: "Sprog",
  },
  en: {
    title: "Check transcript",
    docTitle: "Check transcript – Rolff",
    intro: "Here you can check whether a PDF transcript of a conversation from Rolff is genuine and unchanged. ",
    notSent: "The file is not sent.",
    intro2: " Your device only calculates the file's fingerprint (SHA-256), which is compared with Rolff's register. The page never shows the messages.",
    file: "1. Choose the PDF file from the e-mail",
    pick: "Choose PDF file",
    noFile: "No file chosen",
    fingerprint: (name: string) => `Fingerprint of ${name}: `,
    code: "2. Code from the bottom of the pages (optional if you have chosen the file)",
    checking: "Checking…",
    check: "Check transcript",
    rate: "You have checked many times. Wait 10 minutes and try again.",
    failed: "The check could not be completed. Please try again.",
    foot: "Rolff cannot assess how a court or authority will use the transcript. Test version.",
    lang: "Language",
  },
};

export function VerifyPage({ initialCode = "", initialLang, run }: { initialCode?: string; initialLang?: VerifyLang; run?: (q: { code?: string; sha256?: string }) => Promise<VerifyResult | { error: string }> }) {
  const [lang, setLang] = useState<VerifyLang>(initialLang ?? (typeof document === "undefined" ? "da" : detectLang()));
  const [code, setCode] = useState(initialCode); const [sha, setSha] = useState(""); const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<VerifyResult | { error: string } | null>(null);
  const call = run ?? ((q) => verifyExport((u, i) => fetch(u, i), import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, q));
  const pick = async (f: File | undefined) => { setRes(null); if (!f) return; setFileName(f.name); setSha(await sha256File(await f.arrayBuffer())); };
  const check = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { setRes(await call({ code: normalizeCode(code) || undefined, sha256: sha || undefined })); } catch { setRes({ error: "failed" }); } setBusy(false); };
  const t = T[lang];
  const view = res && "status" in res ? describe(res, lang) : null;
  useEffect(() => {
    try { localStorage.setItem("lang", lang); } catch { /* private mode */ }
    if (typeof document !== "undefined") { document.documentElement.lang = lang; document.title = t.docTitle; }
  }, [lang, t.docTitle]);
  return <main className="wrap verify">
    <header className="verify-head">
      <img src="./favicon.svg" width="44" height="44" alt="" />
      <div><div className="verify-brand">ROLFF</div><h1>{t.title}</h1></div>
      <div className="verify-langs" role="group" aria-label={t.lang}>
        <button type="button" className={lang === "da" ? "is-on" : undefined} aria-pressed={lang === "da"} onClick={() => setLang("da")}>Dansk</button>
        <button type="button" className={lang === "en" ? "is-on" : undefined} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
      </div>
    </header>
    <p>{t.intro}<strong>{t.notSent}</strong>{t.intro2}</p>
    <form className="card verify-form" onSubmit={check}>
      <span id="pdf-legend" className="verify-file-legend">{t.file}</span>
      <div className="verify-file">
        <input
          id="pdf"
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          aria-labelledby="pdf-legend"
          onChange={(e) => pick(e.currentTarget.files?.[0])}
        />
        <label htmlFor="pdf" className="verify-file-btn">{t.pick}</label>
        <span className="verify-file-name" aria-live="polite">{fileName || t.noFile}</span>
      </div>
      {sha && <p className="meta verify-sha">{t.fingerprint(fileName)}<code>{sha}</code></p>}
      <label htmlFor="code">{t.code}</label>
      <input id="code" inputMode="text" autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      <div className="row end"><button type="submit" disabled={busy || (!sha && normalizeCode(code).length !== 20)}>{busy ? t.checking : t.check}</button></div>
    </form>
    {view && <section className={`verify-result ${view.tone}`} role="status" aria-live="polite"><h2>{view.tone === "ok" ? "✓ " : view.tone === "bad" ? "✗ " : "ℹ "}{view.title}</h2>{view.lines.map((l) => <p key={l}>{l}</p>)}</section>}
    {res && "error" in res && <p className="err" role="alert">{res.error === "rate_limited" ? t.rate : t.failed}</p>}
    <p className="meta">{t.foot}</p>
  </main>;
}
const root = typeof document !== "undefined" ? document.getElementById("root") : null;
if (root && !(globalThis as any).__ROLFF_VERIFY_FIXTURE__) createRoot(root).render(<VerifyPage initialCode={codeFromUrl(location.search)} />);

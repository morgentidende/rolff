import { createRoot } from "react-dom/client";
import { useState } from "react";
import { codeFromUrl, describe, normalizeCode, sha256File, verifyExport, type VerifyResult } from "./verifyExport";
import "./styles.css";
import "./verify.css";

export function VerifyPage({ initialCode = "", run }: { initialCode?: string; run?: (q: { code?: string; sha256?: string }) => Promise<VerifyResult | { error: string }> }) {
  const [code, setCode] = useState(initialCode); const [sha, setSha] = useState(""); const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<VerifyResult | { error: string } | null>(null);
  const call = run ?? ((q) => verifyExport((u, i) => fetch(u, i), import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, q));
  const pick = async (f: File | undefined) => { setRes(null); if (!f) return; setFileName(f.name); setSha(await sha256File(await f.arrayBuffer())); };
  const check = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { setRes(await call({ code: normalizeCode(code) || undefined, sha256: sha || undefined })); } catch { setRes({ error: "failed" }); } setBusy(false); };
  const view = res && "status" in res ? describe(res) : null;
  return <main className="wrap verify">
    <header className="verify-head"><img src="./favicon.svg" width="44" height="44" alt="" /><div><div className="verify-brand">ROLFF</div><h1>Tjek udskrift</h1></div></header>
    <p>Her kan du kontrollere, om en PDF-udskrift af en samtale fra Rolff er ægte og uændret. <strong>Filen bliver ikke sendt.</strong> Din enhed beregner kun filens fingeraftryk (SHA-256), som sammenlignes med Rolffs register. Siden viser aldrig beskedernes indhold.</p>
    <form className="card verify-form" onSubmit={check}>
      <label htmlFor="pdf">1. Vælg PDF-filen fra e-mailen</label>
      <input id="pdf" type="file" accept="application/pdf,.pdf" onChange={(e) => pick(e.currentTarget.files?.[0])} />
      {sha && <p className="meta verify-sha">Fingeraftryk af {fileName}: <code>{sha}</code></p>}
      <label htmlFor="code">2. Kode fra bunden af siderne (valgfri, hvis du har valgt filen)</label>
      <input id="code" inputMode="text" autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      <div className="row end"><button type="submit" disabled={busy || (!sha && normalizeCode(code).length !== 20)}>{busy ? "Tjekker…" : "Tjek udskrift"}</button></div>
    </form>
    {view && <section className={`verify-result ${view.tone}`} role="status" aria-live="polite"><h2>{view.tone === "ok" ? "✓ " : view.tone === "bad" ? "✗ " : "ℹ "}{view.title}</h2>{view.lines.map((l) => <p key={l}>{l}</p>)}</section>}
    {res && "error" in res && <p className="err" role="alert">{res.error === "rate_limited" ? "Du har tjekket mange gange. Vent 10 minutter og prøv igen." : "Kontrollen kunne ikke gennemføres. Prøv igen."}</p>}
    <p className="meta">Rolff kan ikke vurdere, hvordan en domstol eller myndighed vil bruge udskriften. Testversion.</p>
  </main>;
}
const root = typeof document !== "undefined" ? document.getElementById("root") : null;
if (root && !(globalThis as any).__ROLFF_VERIFY_FIXTURE__) createRoot(root).render(<VerifyPage initialCode={codeFromUrl(location.search)} />);

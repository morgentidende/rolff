// In-app privacy policy screen: Rolff header + back arrow, app language, and a history entry so
// Android hardware/gesture back returns to the previous app screen (instead of closing the PWA).
import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backNavigation";
import { policyHtml } from "./policyDoc";

export const POLICY_URL = "./privatliv.html";
export function PolicyView({ lang, close }: { lang: "da" | "en"; close: () => void }) {
  const da = lang === "da";
  useBackLayer(true, close);
  const [html, setHtml] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true; setHtml(null); setFailed(false);
    fetch(POLICY_URL, { cache: "no-cache" }).then((r) => r.ok ? r.text() : Promise.reject(new Error(String(r.status))))
      .then((t) => { if (live) setHtml(policyHtml(t, lang)); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [lang]);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const title = da ? "Privatlivspolitik" : "Privacy policy";
  return (
    <div className="docview" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <header className="topbar docbar">
        <button type="button" className="icon" aria-label={da ? "Tilbage" : "Back"} onClick={close}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <img src="./favicon.svg" alt="" width={26} height={26} style={{ borderRadius: 7 }} /><strong className="brand">Rolff</strong>
        <span className="doctitle">{title}</span>
      </header>
      <main className="docbody">
        {html === null && !failed && <p className="meta" role="status">{da ? "Henter …" : "Loading …"}</p>}
        {failed && <p className="err" role="alert">{da ? "Privatlivspolitikken kunne ikke hentes. Tjek din forbindelse og prøv igen." : "The privacy policy could not be loaded. Check your connection and try again."}</p>}
        {html !== null && <article className="policy" dangerouslySetInnerHTML={{ __html: html }} />}
      </main>
    </div>
  );
}

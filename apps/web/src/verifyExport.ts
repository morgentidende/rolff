// Pure helpers for the public "Tjek udskrift" page. The PDF never leaves the device: only its
// SHA-256 (computed with WebCrypto) and/or the printed code are sent to verify-export.
export async function sha256File(buf: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (x) => x.toString(16).padStart(2, "0")).join("");
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 20);
export const codeFromUrl = (search: string) => normalizeCode(new URLSearchParams(search).get("k") ?? "");
export type VerifyResult = { status: "match" | "code_valid" | "mismatch"; created_at?: string | null; period_from?: string | null; period_to?: string | null; partial?: boolean | null; message_count?: number | null; page_count?: number | null };
export type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number; json(): Promise<any> }>;
export async function verifyExport(f: Fetcher, base: string, key: string, q: { code?: string; sha256?: string }): Promise<VerifyResult | { error: string }> {
  const body = JSON.stringify({ code: q.code || null, sha256: q.sha256 || null });
  const r = await f(`${base}/functions/v1/verify-export`, { method: "POST", headers: { "content-type": "application/json", apikey: key }, body });
  const j = await r.json().catch(() => null);
  if (r.status === 200 && j?.data?.status) return j.data as VerifyResult;
  return { error: j?.error === "rate_limited" ? "rate_limited" : "failed" };
}
export type VerifyLang = "da" | "en";
const loc = (lang: VerifyLang) => lang === "en" ? "en-GB" : "da-DK";
const d = (s: string | null | undefined, lang: VerifyLang) => s ? new Date(s).toLocaleDateString(loc(lang), { day: "numeric", month: "long", year: "numeric" }) : "";
export function describe(r: VerifyResult, lang: VerifyLang = "da"): { title: string; tone: "ok" | "info" | "bad"; lines: string[] } {
  const en = lang === "en";
  const meta = [
    r.created_at ? (en
      ? `The transcript was made ${new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}.`
      : `Udskriften blev lavet ${new Date(r.created_at).toLocaleString("da-DK", { dateStyle: "long", timeStyle: "short" })}.`) : "",
    r.partial
      ? (en ? `Excerpt: ${r.period_from ? d(r.period_from, lang) : "start"} – ${r.period_to ? d(r.period_to, lang) : "now"}.`
        : `Udsnit: ${r.period_from ? d(r.period_from, lang) : "start"} – ${r.period_to ? d(r.period_to, lang) : "nu"}.`)
      : (r.created_at ? (en ? "Scope: the whole conversation (as the exporter had access to)." : "Omfang: hele samtalen (som eksportøren havde adgang til).") : ""),
    r.message_count != null ? (en ? `${r.message_count} messages on ${r.page_count ?? "?"} pages.` : `${r.message_count} beskeder på ${r.page_count ?? "?"} sider.`) : "",
  ].filter(Boolean);
  if (r.status === "match") return { title: en ? "Genuine and unchanged" : "Ægte og uændret", tone: "ok", lines: [en ? "The file is exactly the transcript Rolff made and sent. Not a single character has been changed." : "Filen er præcis den udskrift, Rolff lavede og sendte. Ikke ét tegn er ændret.", ...meta] };
  if (r.status === "code_valid") return { title: en ? "The code exists" : "Koden findes", tone: "info", lines: [en ? "The code belongs to a transcript from Rolff. Also choose the PDF file to check that this particular file is unchanged." : "Koden hører til en udskrift fra Rolff. Vælg også PDF-filen for at kontrollere, at netop din fil er uændret.", ...meta] };
  return { title: en ? "Does not match" : "Stemmer ikke", tone: "bad", lines: [en ? "The file or code does not correspond to a transcript from Rolff. The file may have been changed, cropped or saved again by another programme, or the code was typed incorrectly." : "Filen eller koden svarer ikke til en udskrift fra Rolff. Filen kan være ændret, beskåret eller gemt igen af et andet program, eller koden er tastet forkert.", en ? "Ask to get the original PDF from the e-mail." : "Bed om at få den oprindelige PDF fra e-mailen."] };
}

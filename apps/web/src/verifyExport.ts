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
const d = (s?: string | null) => s ? new Date(s).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : "";
export function describe(r: VerifyResult): { title: string; tone: "ok" | "info" | "bad"; lines: string[] } {
  const meta = [
    r.created_at ? `Udskriften blev lavet ${new Date(r.created_at).toLocaleString("da-DK", { dateStyle: "long", timeStyle: "short" })}.` : "",
    r.partial ? `Udsnit: ${r.period_from ? d(r.period_from) : "start"} – ${r.period_to ? d(r.period_to) : "nu"}.` : (r.created_at ? "Omfang: hele samtalen (som eksportøren havde adgang til)." : ""),
    r.message_count != null ? `${r.message_count} beskeder på ${r.page_count ?? "?"} sider.` : "",
  ].filter(Boolean);
  if (r.status === "match") return { title: "Ægte og uændret", tone: "ok", lines: ["Filen er præcis den udskrift, Rolff lavede og sendte. Ikke ét tegn er ændret.", ...meta] };
  if (r.status === "code_valid") return { title: "Koden findes", tone: "info", lines: ["Koden hører til en udskrift fra Rolff. Vælg også PDF-filen for at kontrollere, at netop din fil er uændret.", ...meta] };
  return { title: "Stemmer ikke", tone: "bad", lines: ["Filen eller koden svarer ikke til en udskrift fra Rolff. Filen kan være ændret, beskåret eller gemt igen af et andet program, eller koden er tastet forkert.", "Bed om at få den oprindelige PDF fra e-mailen."] };
}

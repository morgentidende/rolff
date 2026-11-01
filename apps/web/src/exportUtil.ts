// Conversation export helpers (client-side only; message text never touches a server log).
export type Row = { sender: string; time: string; text: string };

/** Neutralises spreadsheet formula injection and quotes per RFC 4180. */
export function csvCell(v: string): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** UTF-8 CSV with BOM, CRLF line endings and a header naming who exported it and when. */
export function toCsv(rows: Row[], exportedBy: string, exportedAt: string, lang: "da" | "en"): string {
  const da = lang === "da";
  const head = [
    [csvCell(da ? `Eksporteret af ${exportedBy}` : `Exported by ${exportedBy}`), csvCell(exportedAt), csvCell("")],
    [csvCell(da ? "Afsender" : "Sender"), csvCell(da ? "Tidspunkt" : "Time"), csvCell(da ? "Tekst" : "Text")],
  ];
  const body = rows.map((r) => [csvCell(r.sender), csvCell(r.time), csvCell(r.text)]);
  return "\uFEFF" + [...head, ...body].map((r) => r.join(",")).join("\r\n") + "\r\n";
}

/** Indices of messages whose text contains the query (case-insensitive). */
export function findHits(texts: string[], q: string): number[] {
  const n = q.trim().toLocaleLowerCase(); if (!n) return [];
  return texts.flatMap((t, i) => (t.toLocaleLowerCase().includes(n) ? [i] : []));
}

export const exportFileName = (ext: "csv" | "pdf", d = new Date()) => `rolff-samtale-${d.toISOString().slice(0, 10)}.${ext}`;

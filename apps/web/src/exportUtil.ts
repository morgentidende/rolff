// Conversation export helpers (client-side only; message text never touches a server log).

/** Neutralises spreadsheet formula injection and quotes per RFC 4180 (used by "Download mine data"). */
export function csvCell(v: string): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Indices of messages whose text contains the query (case-insensitive). */
export function findHits(texts: string[], q: string): number[] {
  const n = q.trim().toLocaleLowerCase(); if (!n) return [];
  return texts.flatMap((t, i) => (t.toLocaleLowerCase().includes(n) ? [i] : []));
}


// ---------- "Download mine data" (art. 15): files built on the device ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** Minimal ZIP (method 0 = stored) – no dependency, enough for a few text files. */
export function makeZip(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
const csvTable = (rows: Record<string, unknown>[]): string => {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return "\uFEFF" + [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]) : String(r[c] ?? ""))).join(","))].join("\r\n") + "\r\n";
};
/** data.json + one CSV per list (BOM, formula-escaped) + messages.csv across conversations. */
export function myDataFiles(d: any): { name: string; data: string }[] {
  const files = [{ name: "rolff-data.json", data: JSON.stringify(d, null, 2) }];
  const msgs = (d.conversations ?? []).flatMap((c: any) => (c.messages ?? []).map((m: any) => ({ conversation_id: c.conversation_id, created_at: m.created_at, from: m.from, text: m.text })));
  files.push({ name: "messages.csv", data: csvTable(msgs) });
  files.push({ name: "account.csv", data: csvTable([{ ...(d.account ?? {}), ...(d.profile ?? {}), ...(d.privacy_settings ?? {}) }]) });
  for (const k of ["memberships", "own_private_aliases", "own_blocked_words", "own_blocked_topics", "own_conversation_blocks", "invitations_created", "consents_given", "feedback", "reports_metadata", "moderation_attempts_metadata", "receive_windows"])
    files.push({ name: `${k}.csv`, data: csvTable(d[k] ?? []) });
  files.push({ name: "LÆS-MIG.txt", data: "Rolff – dine egne data (GDPR art. 15). Indeholder kun data om dig og beskeder, du selv kan se i appen. / Your own data only.\r\n" });
  return files;
}

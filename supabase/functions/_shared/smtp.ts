// Minimal SMTP client for authenticated submission over implicit TLS (port 465), plus a MIME builder.
// Used by sendMail for invitation and account mail. Never logs or returns message content or addresses:
// a failure is reported only as "<stage>:<code>".
export type SmtpConn = { read(p: Uint8Array): Promise<number | null>; write(p: Uint8Array): Promise<number>; close(): void };
export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string; heloName?: string };
export type SmtpResult = { ok: boolean; code: number | null; reason: string };
export type Connect = (host: string, port: number) => Promise<SmtpConn>;

export const defaultConnect: Connect = (hostname, port) => Deno.connectTls({ hostname, port });

const enc = new TextEncoder(), dec = new TextDecoder();
const ADDR_RE = /^[^\s@<>"(),;:\\\[\]]+@[^\s@<>"(),;:\\\[\]]+\.[^\s@<>"(),;:\\\[\]]+$/;
export const validAddress = (a: string) => a.length <= 254 && ADDR_RE.test(a);

class Reader {
  private buf = "";
  constructor(private c: SmtpConn) {}
  async reply(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      let nl = this.buf.indexOf("\n");
      while (nl < 0) {
        const chunk = new Uint8Array(4096); const n = await this.c.read(chunk);
        if (n === null) throw new SmtpError("conn", null);
        this.buf += dec.decode(chunk.subarray(0, n)); nl = this.buf.indexOf("\n");
        if (this.buf.length > 65536) throw new SmtpError("proto", null);
      }
      const line = this.buf.slice(0, nl).replace(/\r$/, ""); this.buf = this.buf.slice(nl + 1);
      lines.push(line);
      if (!/^\d{3}[ -]/.test(line) && !/^\d{3}$/.test(line)) throw new SmtpError("proto", null);
      if (line[3] !== "-") return { code: Number(line.slice(0, 3)), lines };
    }
  }
}
class SmtpError extends Error { constructor(public stage: string, public code: number | null) { super(`${stage}:${code ?? "-"}`); } }

/** Send one message. `raw` is a complete RFC 5322 message with CRLF line endings. */
export async function smtpSend(cfg: SmtpConfig, to: string, raw: string, connect: Connect = defaultConnect, timeoutMs = 20000): Promise<SmtpResult> {
  if (!validAddress(to) || !validAddress(cfg.from)) return { ok: false, code: null, reason: "bad_address" };
  let conn: SmtpConn | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
  try {
    conn = await connect(cfg.host, cfg.port);
    const c = conn;
    timer = setTimeout(() => { timedOut = true; try { c.close(); } catch { /* ignore */ } }, timeoutMs);
    const r = new Reader(c);
    const send = async (line: string) => { await writeAll(c, enc.encode(line + "\r\n")); };
    const expect = async (stage: string, ok: number[]) => { const x = await r.reply(); if (!ok.includes(x.code)) throw new SmtpError(stage, x.code); return x; };
    await expect("greeting", [220]);
    await send(`EHLO ${cfg.heloName ?? "rolff.local"}`); await expect("ehlo", [250]);
    await send(`AUTH PLAIN ${btoa(String.fromCharCode(...enc.encode(`\0${cfg.user}\0${cfg.pass}`)))}`); await expect("auth", [235]);
    await send(`MAIL FROM:<${cfg.from}>`); await expect("mail", [250]);
    await send(`RCPT TO:<${to}>`); await expect("rcpt", [250, 251]);
    await send("DATA"); await expect("data", [354]);
    const body = raw.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    await writeAll(c, enc.encode(body + (body.endsWith("\r\n") ? "" : "\r\n") + ".\r\n"));
    const done = await expect("body", [250]);
    try { await send("QUIT"); } catch { /* the message is already accepted */ }
    return { ok: true, code: done.code, reason: "ok" };
  } catch (e) {
    if (timedOut) return { ok: false, code: null, reason: "timeout" };
    if (e instanceof SmtpError) return { ok: false, code: e.code, reason: e.message };
    return { ok: false, code: null, reason: conn ? "conn" : "connect" };
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch { /* already closed */ }
  }
}
async function writeAll(c: SmtpConn, b: Uint8Array) { let o = 0; while (o < b.length) o += await c.write(b.subarray(o)); }

const b64 = (s: string | Uint8Array) => { const u = typeof s === "string" ? enc.encode(s) : s; let bin = ""; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); };
const wrap76 = (s: string) => (s.match(/.{1,76}/g) ?? []).join("\r\n");
/** RFC 2047 encoded-words, split on code points so no UTF-8 sequence is cut. */
export function encodeHeader(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s) && s.length <= 900) return s;
  const parts: string[] = []; let cur = "";
  for (const ch of s) { if (enc.encode(cur + ch).length > 45) { parts.push(cur); cur = ""; } cur += ch; }
  if (cur) parts.push(cur);
  return parts.map((p) => `=?UTF-8?B?${b64(p)}?=`).join("\r\n ");
}
export type MimeAttachment = { filename: string; content_type: "application/pdf" | "text/html"; content_b64: string };
export type MimeInput = { from: string; fromName: string; to: string; subject: string; html: string; text: string; replyTo?: string; attachments?: MimeAttachment[]; date?: Date; messageId?: string };

export function buildMime(m: MimeInput): string {
  if ([m.to, m.subject, m.from, m.fromName, m.replyTo ?? ""].some((v) => /[\r\n]/.test(v))) throw new Error("header_injection");
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  const domain = m.from.split("@")[1];
  const b = `rolff_${rand()}`;
  const name = /^[A-Za-z0-9 ]+$/.test(m.fromName) ? `"${m.fromName}"` : encodeHeader(m.fromName);
  const head = [
    `From: ${name} <${m.from}>`,
    `To: <${m.to}>`,
    `Reply-To: <${m.replyTo || m.from}>`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${m.messageId ?? `${rand()}.${Date.now()}`}@${domain}>`,
    "MIME-Version: 1.0",
  ];
  const alt = `--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(m.text))}\r\n`
    + `--${b}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(m.html))}\r\n--${b}--\r\n`;
  if (!m.attachments?.length) return [...head, `Content-Type: multipart/alternative; boundary="${b}"`].join("\r\n") + "\r\n\r\n" + alt;
  const mx = `rolffm_${rand()}`;
  let body = `--${mx}\r\nContent-Type: multipart/alternative; boundary="${b}"\r\n\r\n${alt}`;
  for (const a of m.attachments) {
    const html = a.content_type === "text/html" && /^[A-Za-z0-9._-]{1,80}\.html$/.test(a.filename);
    const pdf = a.content_type === "application/pdf" && /^[A-Za-z0-9._-]{1,80}\.pdf$/.test(a.filename);
    if (!html && !pdf) throw new Error("bad_attachment");
    const ctype = pdf ? "application/pdf" : "text/html; charset=UTF-8";
    body += `--${mx}\r\nContent-Type: ${ctype}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(a.content_b64.replace(/\s+/g, ""))}\r\n`;
  }
  body += `--${mx}--\r\n`;
  return [...head, `Content-Type: multipart/mixed; boundary="${mx}"`].join("\r\n") + "\r\n\r\n" + body;
}

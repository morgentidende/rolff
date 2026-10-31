import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { callFn, supabase } from "./supabase";
import { detectLang, strings, type Lang } from "./i18n";

type Conv = { id: string; title: string | null; role: string; members: number };
type Msg = { id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; mine: boolean };
const MAX = 480;
const count = (s: string) => [...s].length;

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang());
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [session, setSession] = useState<Session | null>(null);
  const [conv, setConv] = useState<Conv | null>(null);
  const [view, setView] = useState<"home" | "settings">("home");
  const t = strings[lang];
  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    localStorage.setItem("theme", theme);
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [theme]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <div className="wrap">
      <div className="row"><strong style={{ fontSize: 22 }}>Rolff</strong><span className="spacer" />
        <select aria-label={t.lang} style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="da">Dansk</option><option value="en">English</option></select>
        <select aria-label={t.theme} style={{ width: "auto" }} value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select>
        {session && <button className="ghost" onClick={() => setView(view === "settings" ? "home" : "settings")}>{view === "settings" ? t.back : t.settings}</button>}
        {session && <button className="ghost" onClick={() => { setConv(null); supabase.auth.signOut(); }}>{t.logout}</button>}
      </div>
      <div className="notice" role="note">{t.testNotice}</div>
      {!session ? <Auth lang={lang} /> : view === "settings" ? <ReceiveSettings lang={lang} /> : conv ? <Chat lang={lang} conv={conv} back={() => setConv(null)} /> : <Home lang={lang} open={setConv} />}
    </div>
  );
}

function Auth({ lang }: { lang: Lang }) {
  const t = strings[lang];
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [name, setName] = useState(""); const [ai, setAi] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    const r = mode === "login" ? await supabase.auth.signInWithPassword({ email, password: pw })
      : await supabase.auth.signUp({ email, password: pw, options: { data: { display_name: name } } });
    setBusy(false);
    if (r.error) setErr(t.authError); // generic: does not reveal whether account exists
  };
  return (
    <div className="card">
      <h1>Rolff</h1><p>{t.tagline}</p><p>{t.intro}</p>
      <form onSubmit={submit}>
        {mode === "signup" && <><label htmlFor="n">{t.name}</label><input id="n" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></>}
        <label htmlFor="e">{t.email}</label><input id="e" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="p">{t.password}</label><input id="p" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} />
        {mode === "signup" && <p><label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={ai} onChange={(e) => setAi(e.target.checked)} required />{t.ai} {t.aiAccept}</label></p>}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy}>{mode === "login" ? t.login : t.signup}</button>
          <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? t.signup : t.login}</button>
        </div>
      </form>
    </div>
  );
}

function Home({ lang, open }: { lang: Lang; open: (c: Conv) => void }) {
  const t = strings[lang];
  const [convs, setConvs] = useState<Conv[]>([]); const [title, setTitle] = useState(""); const [code, setCode] = useState(""); const [err, setErr] = useState("");
  const load = useCallback(async () => { const { data } = await supabase.rpc("list_my_conversations"); setConvs((data as Conv[]) ?? []); }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => { const { error } = await supabase.rpc("create_conversation", { p_title: title }); if (!error) { setTitle(""); load(); } };
  const join = async () => {
    setErr("");
    const r = await callFn("invitation", { action: "accept", token: code.trim() });
    if (r.status !== 200) setErr(r.data?.error === "consent_missing" ? "Afventer samtykke / awaiting consent" : t.invalidInvite); else { setCode(""); load(); }
  };
  return (
    <>
      <div className="card list"><h2>{t.conversations}</h2>
        {convs.length === 0 && <p className="meta">—</p>}
        {convs.map((c) => <button key={c.id} onClick={() => open(c)}>{c.title || "Samtale"} <span className="meta">· {c.members} {t.members.toLowerCase()}</span></button>)}
      </div>
      <div className="card"><h2>{t.newConv}</h2><div className="row"><input aria-label={t.title} placeholder={t.title} value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} /><button onClick={create}>{t.create}</button></div></div>
      <div className="card"><h2>{t.join}</h2><div className="row"><input aria-label={t.code} placeholder={t.code} value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1 }} /><button onClick={join} disabled={!code.trim()}>OK</button></div>{err && <p className="err" role="alert">{err}</p>}</div>
    </>
  );
}

function highlight(text: string, spans: string[]) {
  if (!spans.length) return text;
  const parts: (string | React.ReactElement)[] = []; let rest = text; let k = 0;
  for (const s of spans) { const i = rest.indexOf(s); if (i < 0) continue; parts.push(rest.slice(0, i), <mark key={k++}>{s}</mark>); rest = rest.slice(i + s.length); }
  parts.push(rest); return parts;
}

function Chat({ lang, conv, back }: { lang: Lang; conv: Conv; back: () => void }) {
  const t = strings[lang];
  const draftKey = `draft:${conv.id}`;
  const [msgs, setMsgs] = useState<Msg[]>([]); const [pending, setPending] = useState(0);
  const [text, setText] = useState(localStorage.getItem(draftKey) ?? "");
  const [status, setStatus] = useState<{ kind: string; spans?: string[]; blockedText?: string } | null>(null);
  const [busy, setBusy] = useState(false); const [invite, setInvite] = useState<{ token: string; expires_at: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_messages", { conv: conv.id }); if (data) setMsgs(data as Msg[]);
    const p = await supabase.rpc("my_pending_count"); setPending((p.data as number) ?? 0);
  }, [conv.id]);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  useEffect(() => { localStorage.setItem(draftKey, text); }, [text, draftKey]);
  const send = async () => {
    if (!text.trim() || count(text) > MAX) return;
    setBusy(true); setStatus(null);
    // Same key across retries of the same text -> no duplicates on network retry / reload.
    const keyStore = `idem:${conv.id}`; let saved = JSON.parse(localStorage.getItem(keyStore) || "null");
    if (!saved || saved.text !== text) { saved = { text, key: crypto.randomUUID() }; localStorage.setItem(keyStore, JSON.stringify(saved)); }
    let r; try { r = await callFn("send-message", { conversation_id: conv.id, body: text, idempotency_key: saved.key }); } catch { r = { status: 0, data: null }; }
    setBusy(false);
    if (r.status === 200 && r.data?.status === "accepted") { setText(""); localStorage.removeItem(keyStore); setStatus({ kind: "accepted" }); load(); }
    else if (r.status === 200 && r.data?.status === "blocked") setStatus({ kind: "blocked", spans: r.data.spans ?? [], blockedText: text });
    else if (r.data?.error === "read_only") setStatus({ kind: "readOnly" });
    else if (r.status === 429) setStatus({ kind: "rateLimited" });
    else setStatus({ kind: "techError" });
  };
  const makeInvite = async () => { const r = await callFn("invitation", { action: "create", conversation_id: conv.id, role: "parent" }); if (r.status === 200) setInvite(r.data.data); };
  const receiveNow = async () => { await callFn("receive-now", {}); load(); };
  const n = count(text);
  return (
    <>
      <div className="row"><button className="ghost" onClick={back}>← {t.back}</button><h2 style={{ margin: 0 }}>{conv.title || "Samtale"}</h2><span className="spacer" />
        {conv.role === "parent" && conv.members < 2 && <button className="ghost" onClick={makeInvite}>{t.invite}</button>}</div>
      {invite && <div className="card"><p>{t.inviteHint} {new Date(invite.expires_at).toLocaleString(lang)}.</p><code>{invite.token}</code><div><button className="ghost" onClick={() => navigator.clipboard.writeText(invite.token)}>{t.copy}</button></div></div>}
      {pending > 0 && <div className="notice row"><span>{t.pending(pending)}</span><span className="spacer" /><button onClick={receiveNow}>{t.receiveNow}</button></div>}
      <div className="card msgs" aria-live="polite">
        {msgs.length === 0 && <p className="meta">{t.empty}</p>}
        {msgs.map((m) => <div key={m.id} className={`msg ${m.mine ? "mine" : "theirs"}`}><div className="meta">{m.mine ? t.you : m.sender_name} · {new Date(m.created_at).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" })}</div>{m.body}</div>)}
        <div ref={endRef} />
      </div>
      {status?.kind === "blocked" && <div className="notice" role="alert"><p style={{ margin: 0 }}>{t.blocked}</p>{status.spans!.length > 0 && <p className="meta" style={{ marginBottom: 0 }}>{t.flagged}: {highlight(status.blockedText!, status.spans!)}</p>}</div>}
      {status && status.kind !== "blocked" && <div className={status.kind === "accepted" ? "notice" : "err"} role="status">{(t as any)[status.kind]}</div>}
      {conv.role !== "reader" ? (
        <div className="card">
          <textarea aria-label={t.write} placeholder={t.write} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row"><span className="meta" style={{ color: n > MAX ? "crimson" : undefined }}>{n}/{MAX}</span><span className="spacer" /><button onClick={send} disabled={busy || !text.trim() || n > MAX}>{busy ? t.sending : t.send}</button></div>
        </div>) : <p className="meta">{t.readOnly}</p>}
    </>
  );
}

const TZS = ["Europe/Copenhagen", "Europe/London", "Europe/Berlin", "Europe/Stockholm", "Europe/Oslo", "America/New_York", "UTC"];
type W = { weekday: number; start_minute: number; end_minute: number };
const toHM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHM = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

function ReceiveSettings({ lang }: { lang: Lang }) {
  const t = strings[lang];
  const [enabled, setEnabled] = useState(false); const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Copenhagen");
  const [ws, setWs] = useState<W[]>([]); const [msg, setMsg] = useState("");
  useEffect(() => { (async () => {
    const { data: u } = await supabase.auth.getUser(); if (!u.user) return;
    const s = await supabase.from("receive_settings").select("*").maybeSingle(); if (s.data) { setEnabled(s.data.enabled); setTz(s.data.timezone); }
    const w = await supabase.from("receive_windows").select("weekday,start_minute,end_minute").order("weekday"); setWs((w.data as W[]) ?? []);
  })(); }, []);
  const save = async () => {
    const { data: u } = await supabase.auth.getUser(); const uid = u.user!.id;
    await supabase.from("receive_settings").upsert({ user_id: uid, timezone: tz, enabled });
    await supabase.from("receive_windows").delete().eq("user_id", uid);
    if (ws.length) await supabase.from("receive_windows").insert(ws.map((w) => ({ ...w, user_id: uid })));
    setMsg(t.saved);
  };
  const tzs = TZS.includes(tz) ? TZS : [tz, ...TZS];
  return (
    <div className="card"><h2>{t.windows}</h2>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t.windowsOn}</label>
      <label htmlFor="tz">{t.tz}</label><select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>{tzs.map((z) => <option key={z}>{z}</option>)}</select>
      {ws.map((w, i) => (
        <div className="row" key={i} style={{ marginTop: 8 }}>
          <select aria-label="Dag" style={{ width: 90 }} value={w.weekday} onChange={(e) => setWs(ws.map((x, j) => j === i ? { ...x, weekday: +e.target.value } : x))}>{t.days.map((d, k) => <option key={k} value={k + 1}>{d}</option>)}</select>
          <label>{t.from}</label><input type="time" style={{ width: 120 }} value={toHM(w.start_minute)} onChange={(e) => setWs(ws.map((x, j) => j === i ? { ...x, start_minute: fromHM(e.target.value) } : x))} />
          <label>{t.to}</label><input type="time" style={{ width: 120 }} value={toHM(w.end_minute)} onChange={(e) => setWs(ws.map((x, j) => j === i ? { ...x, end_minute: fromHM(e.target.value) } : x))} />
          <button className="ghost" onClick={() => setWs(ws.filter((_, j) => j !== i))}>{t.remove}</button>
        </div>))}
      <div className="row" style={{ marginTop: 12 }}><button className="ghost" onClick={() => setWs([...ws, { weekday: 1, start_minute: 17 * 60, end_minute: 20 * 60 }])}>{t.add}</button><span className="spacer" /><span className="meta">{msg}</span><button onClick={save}>{t.save}</button></div>
    </div>
  );
}

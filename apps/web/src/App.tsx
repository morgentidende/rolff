import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { callFn, supabase } from "./supabase";
import { detectLang, strings, type Lang } from "./i18n";
import { passwordsMatch, pwText, toggleLabel } from "./pw";
import { exportFileName, findHits, toCsv, type Row } from "./exportUtil";

type Other = { user_id: string; email: string; alias: string | null };
type Conv = { id: string; role: string; members: number; others: Other[]; color: string | null };
const labelOf = (o: Other) => o.alias || o.email;
const convLabel = (c: Conv, da: boolean) => c.others?.length ? c.others.map(labelOf).join(", ") : (da ? "Venter på modpart" : "Waiting for the other parent");
type Msg = { id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; mine: boolean };
const MAX = 480;
const count = (s: string) => [...s].length;

type Peek = { inviter_email: string; invitee_email: string; expires_at: string };
// Invite link: #invite=TOKEN. Kept in sessionStorage until accepted, then removed from URL.
function readInviteToken(): string | null {
  const m = location.hash.match(/invite=([0-9a-f]{16,128})/);
  if (m) { sessionStorage.setItem("invite", m[1]); history.replaceState(null, "", location.pathname + location.search); }
  return sessionStorage.getItem("invite");
}

type Sheet = null | "lang" | "theme" | "times" | "faq" | "feedback" | "invite" | "export" | "addMember";
export type MenuItem = { label: string; run: () => void; danger?: boolean };

export function App() {
  const [inviteToken, setInviteToken] = useState<string | null>(() => readInviteToken());
  const [peek, setPeek] = useState<Peek | null | undefined>(undefined);
  const [inviteMsg, setInviteMsg] = useState("");
  const [lang, setLang] = useState<Lang>(detectLang());
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [session, setSession] = useState<Session | null>(null);
  const [conv, setConv] = useState<Conv | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [homeKey, setHomeKey] = useState(0);
  const t = strings[lang]; const da = lang === "da";
  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    localStorage.setItem("theme", theme);
    const apply = () => { const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; };
    apply(); const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!inviteToken) return;
    supabase.rpc("peek_invitation", { p_token: inviteToken }).then(({ data }) => setPeek(((data as Peek[]) ?? [])[0] ?? null));
  }, [inviteToken]);
  useEffect(() => {
    if (!session || !inviteToken) return;
    callFn("invitation", { action: "accept", token: inviteToken }).then((r) => {
      sessionStorage.removeItem("invite"); setInviteToken(null);
      if (r.status === 200) supabase.rpc("list_my_conversations").then(({ data }) => { const c = ((data as Conv[]) ?? []).find((x) => x.id === r.data?.data); if (c) setConv(c); });
      setInviteMsg(r.status === 200 ? (da ? "Du er nu med i samtalen." : "You have joined the conversation.")
        : (da ? "Invitationen kunne ikke bruges. Den kan være udløbet, brugt eller sendt til en anden e-mail." : "The invitation could not be used. It may be expired, used, or meant for another email."));
    });
  }, [session, inviteToken]);
  const menu: MenuItem[] = [
    { label: t.lang, run: () => setSheet("lang") },
    { label: t.theme, run: () => setSheet("theme") },
    { label: t.windows, run: () => setSheet("times") },
    { label: "FAQ", run: () => setSheet("faq") },
    { label: "Feedback", run: () => setSheet("feedback") },
    { label: da ? "Inviter person" : "Invite person", run: () => setSheet("invite") },
    { label: t.logout, run: () => { setConv(null); setSheet(null); supabase.auth.signOut(); }, danger: true },
  ];
  const close = () => setSheet(null);
  return (
    <div className="wrap">
      {!(session && conv) && <header className="topbar"><img src="./favicon.svg" alt="" width={30} height={30} style={{ borderRadius: 8 }} /><strong className="brand">Rolff</strong><span className="spacer" />
        {session ? <Menu lang={lang} items={menu} /> : <>
          <select aria-label={t.lang} className="compact" value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="da">Dansk</option><option value="en">English</option></select>
          <select aria-label={t.theme} className="compact" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></>}
      </header>}
      <div className="notice" role="note">{t.testNotice}</div>
      {inviteMsg && <div className="notice" role="status">{inviteMsg}</div>}
      {!session ? <Auth lang={lang} peek={inviteToken ? peek : undefined} />
        : conv ? <Chat lang={lang} conv={conv} back={() => setConv(null)} menu={menu} />
        : <Home key={homeKey} lang={lang} open={setConv} invite={() => setSheet("invite")} />}
      {sheet === "lang" && <SheetView title={t.lang} close={close} lang={lang}><Choice name="lang" value={lang} set={(v) => setLang(v as Lang)} opts={[["da", "Dansk"], ["en", "English"]]} /></SheetView>}
      {sheet === "theme" && <SheetView title={t.theme} close={close} lang={lang}><Choice name="theme" value={theme} set={setTheme} opts={[["dark", t.dark], ["light", t.light], ["system", t.system]]} /></SheetView>}
      {sheet === "times" && <SheetView title={t.windows} close={close} lang={lang}><ReceiveSettings lang={lang} /></SheetView>}
      {sheet === "faq" && <SheetView title="FAQ" close={close} lang={lang}><Faq lang={lang} /></SheetView>}
      {sheet === "feedback" && <SheetView title="Feedback" close={close} lang={lang}><FeedbackForm lang={lang} /></SheetView>}
      {sheet === "invite" && <SheetView title={da ? "Inviter person" : "Invite person"} close={close} lang={lang}><InviteByEmail lang={lang} done={() => setHomeKey(homeKey + 1)} /></SheetView>}
    </div>
  );
}

function Menu({ lang, items }: { lang: Lang; items: MenuItem[] }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menuwrap" ref={ref}>
      <button type="button" className="icon" aria-label={lang === "da" ? "Menu" : "Menu"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
      </button>
      {open && <div className="menu" role="menu">{items.map((it) => <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.run(); }}>{it.label}</button>)}</div>}
    </div>
  );
}

function SheetView({ title, close, lang, children }: { title: string; close: () => void; lang: Lang; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", esc); ref.current?.focus(); return () => document.removeEventListener("keydown", esc); }, [close]);
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sheethead"><h2>{title}</h2><button type="button" className="icon" aria-label={lang === "da" ? "Luk" : "Close"} onClick={close}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function Choice({ name, value, set, opts }: { name: string; value: string; set: (v: string) => void; opts: [string, string][] }) {
  return <div className="choices" role="radiogroup">{opts.map(([v, l]) => <label key={v} className="choice"><input type="radio" name={name} checked={value === v} onChange={() => set(v)} /><span>{l}</span></label>)}</div>;
}

function Faq({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const qa: [string, string][] = da ? [
    ["Kan den anden se, om jeg har læst en besked eller er online?", "Nej. Rolff har ingen læsekvitteringer, ingen online-status og ingen “skriver…”-indikator."],
    ["Hvad gør AI-tonetjekket?", "Før en besked sendes, vurderer en AI-tjeneste tonen. Kan beskeden opfattes som sårende, bliver den ikke sendt, og du kan rette den. Beskeden og op til 10 nyere beskeder sendes til tjenesten."],
    ["Hvad er modtagetider?", "Du kan vælge, hvornår på ugen nye beskeder når frem til dig. Beskeder, der kommer uden for dine tider, venter, til næste modtagetid – eller til du selv trykker “Modtag beskeder nu”."],
    ["Hvordan kommer man ind i en samtale?", "Kun via invitation på e-mail. Ekstra deltagere (fx advokat eller sagsbehandler) får først adgang, når alle i samtalen har godkendt, og de ser ingen beskeder fra før, de kom med."],
    ["Er det her den rigtige app?", "Nej, det er et testmiljø. Skriv kun opdigtede beskeder. AI-tjekket kører på en gratis testtjeneste."],
  ] : [
    ["Can the other person see if I read a message or am online?", "No. Rolff has no read receipts, no online status and no typing indicator."],
    ["What does the AI tone check do?", "Before a message is sent, an AI service assesses its tone. If it may come across as hurtful, it is not sent and you can edit it. The message and up to 10 recent messages are sent to the service."],
    ["What are receive times?", "You choose when during the week new messages reach you. Messages arriving outside your times wait until the next receive time – or until you tap “Receive messages now”."],
    ["How do people join a conversation?", "Only by e-mail invitation. Extra participants (e.g. a lawyer or caseworker) only get access when everyone in the conversation has approved, and they see no messages from before they joined."],
    ["Is this the real app?", "No, this is a test environment. Write made-up messages only. The AI check runs on a free test service."],
  ];
  return <div className="faq">{qa.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>;
}

function FeedbackForm({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [cat, setCat] = useState("idea"); const [body, setBody] = useState(""); const [state, setState] = useState<"" | "busy" | "ok" | "err">("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setState("busy");
    const { error } = await supabase.from("feedback").insert({ category: cat, body: body.trim() });
    if (error) setState("err"); else { setState("ok"); setBody(""); }
  };
  return (
    <form onSubmit={submit}>
      <p className="meta">{da ? "Skriv ikke beskeder fra samtaler her. Kun udviklerne kan læse din feedback." : "Do not paste conversation messages here. Only the developers can read your feedback."}</p>
      <label htmlFor="fc">{da ? "Kategori (valgfri)" : "Category (optional)"}</label>
      <select id="fc" value={cat} onChange={(e) => setCat(e.target.value)}><option value="idea">{da ? "Idé" : "Idea"}</option><option value="problem">{da ? "Problem" : "Problem"}</option><option value="other">{da ? "Andet" : "Other"}</option></select>
      <label htmlFor="fb">{da ? "Din feedback" : "Your feedback"}</label>
      <textarea id="fb" rows={5} maxLength={2000} required value={body} onChange={(e) => { setBody(e.target.value); setState(""); }} />
      <div className="row end"><button type="submit" disabled={state === "busy" || !body.trim()}>{da ? "Send feedback" : "Send feedback"}</button></div>
      {state === "ok" && <p className="meta" role="status">{da ? "Tak! Din feedback er gemt." : "Thanks! Your feedback was saved."}</p>}
      {state === "err" && <p className="err" role="alert">{da ? "Feedback kunne ikke gemmes." : "Could not save feedback."}</p>}
    </form>
  );
}

function Auth({ lang, peek }: { lang: Lang; peek?: Peek | null }) {
  const t = strings[lang];
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  useEffect(() => { if (peek) { setMode("signup"); setEmail(peek.invitee_email); } }, [peek]); const [ai, setAi] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (mode === "signup" && !passwordsMatch(pw, pw2)) { setErr(pwText[lang].mismatch); return; }
    setBusy(true);
    const r = mode === "login" ? await supabase.auth.signInWithPassword({ email, password: pw })
      : await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (r.error) setErr(t.authError); // generic: does not reveal whether account exists
  };
  return (
    <div className="card">
      <div style={{ textAlign: "center" }}><img src="./icons/rolff-192.png" alt="Rolff logo" width={96} height={96} style={{ borderRadius: 22 }} /><h1 style={{ marginTop: 8 }}>Rolff</h1></div>
      {peek ? <div className="notice"><strong>{lang === "da" ? `${peek.inviter_email} har inviteret dig.` : `${peek.inviter_email} invited you.`}</strong> {lang === "da" ? "Vælg en adgangskode for at komme ind i samtalen. Har du allerede en konto, så log ind." : "Choose a password to join. Already have an account? Log in."}</div>
        : peek === null ? <div className="notice" role="alert">{lang === "da" ? "Invitationen er ugyldig, udløbet eller allerede brugt." : "The invitation is invalid, expired or already used."}</div> : null}
      <p>{t.tagline}</p><p>{t.intro}</p>
      <form onSubmit={submit}>
        <label htmlFor="e">{t.email}</label><input id="e" type="email" required autoComplete="email" readOnly={!!peek} value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="p">{t.password}</label>
        <PasswordInput id="p" lang={lang} value={pw} onChange={setPw} minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {mode === "signup" && <><label htmlFor="p2">{pwText[lang].repeat}</label>
          <PasswordInput id="p2" lang={lang} value={pw2} onChange={(v) => { setPw2(v); setErr(""); }} minLength={8} autoComplete="new-password" invalid={pw2.length > 0 && !passwordsMatch(pw, pw2)} describedBy="pwerr" /></>}
        {mode === "signup" && <p><label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={ai} onChange={(e) => setAi(e.target.checked)} required />{t.ai} {t.aiAccept}</label></p>}
        {err ? <p className="err" id="pwerr" role="alert">{err}</p>
          : mode === "signup" && pw2.length > 0 && !passwordsMatch(pw, pw2) ? <p className="err" id="pwerr" aria-live="polite">{pwText[lang].mismatch}</p> : null}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy}>{mode === "login" ? t.login : t.signup}</button>
          <button type="button" className="ghost" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setPw2(""); setErr(""); }}>{mode === "login" ? t.signup : t.login}</button>
        </div>
      </form>
    </div>
  );
}

function PasswordInput(p: { id: string; lang: Lang; value: string; onChange: (v: string) => void; minLength: number; autoComplete: string; invalid?: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false);
  const label = toggleLabel(p.lang, show);
  return (
    <div className="pw">
      <input id={p.id} name={p.id === "p" ? "password" : "password-repeat"} type={show ? "text" : "password"} required minLength={p.minLength} autoComplete={p.autoComplete}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} value={p.value} onChange={(e) => p.onChange(e.target.value)}
        aria-invalid={p.invalid || undefined} aria-describedby={p.invalid ? p.describedBy : undefined} />
      <button type="button" className="eye" aria-label={label} title={label} aria-pressed={show} aria-controls={p.id} onClick={() => setShow(!show)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" />{show && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
    </div>
  );
}

const COLORS = ["teal", "blue", "violet", "rose", "red", "amber", "green", "slate"] as const;
const COLOR_NAMES: Record<string, [string, string]> = { teal: ["Petrol", "Teal"], blue: ["Blå", "Blue"], violet: ["Lilla", "Violet"], rose: ["Rosa", "Rose"], red: ["Rød", "Red"], amber: ["Rav", "Amber"], green: ["Grøn", "Green"], slate: ["Grå", "Slate"] };

function ColorDot({ lang, conv, label, changed }: { lang: Lang; conv: Conv; label: string; changed: (c: string) => void }) {
  const da = lang === "da"; const [open, setOpen] = useState(false); const color = conv.color || "teal";
  const pick = async (c: string) => { const { error } = await supabase.rpc("set_conversation_color", { conv: conv.id, p_color: c }); if (!error) { changed(c); setOpen(false); } };
  return (
    <span className="dotwrap">
      <button type="button" className={`dot c-${color}`} aria-label={da ? `Vælg farve for samtalen med ${label}` : `Choose colour for conversation with ${label}`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <span aria-hidden="true">{(label.trim()[0] || "?").toUpperCase()}</span>
      </button>
      {open && <span className="palette" role="group" aria-label={da ? "Farver (kun synlige for dig)" : "Colours (only visible to you)"}>
        {COLORS.map((c) => <button key={c} type="button" className={`swatch c-${c}`} aria-label={COLOR_NAMES[c][da ? 0 : 1]} aria-pressed={c === color} onClick={(e) => { e.stopPropagation(); pick(c); }}>{c === color ? "✓" : ""}</button>)}
      </span>}
    </span>
  );
}

function Home({ lang, open, invite }: { lang: Lang; open: (c: Conv) => void; invite: () => void }) {
  const t = strings[lang]; const da = lang === "da";
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const load = useCallback(async () => { const { data } = await supabase.rpc("list_my_conversations"); setConvs((data as Conv[]) ?? []); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card list"><h2>{t.conversations}</h2>
      {convs?.length === 0 && <p className="meta">{da ? "Ingen samtaler endnu. " : "No conversations yet. "}<button type="button" className="linkbtn" onClick={invite}>{da ? "Inviter en person" : "Invite someone"}</button></p>}
      {(convs ?? []).map((c) => { const label = convLabel(c, da); return (
        <div key={c.id} className="convrow">
          <ColorDot lang={lang} conv={c} label={label} changed={(col) => setConvs((convs ?? []).map((x) => x.id === c.id ? { ...x, color: col } : x))} />
          <button className="convbtn" onClick={() => open(c)}>{label}{c.others.length === 0 && <span className="meta"> · {da ? "venter på accept" : "awaiting acceptance"}</span>}</button>
        </div>); })}
    </div>
  );
}

function InviteByEmail({ lang, done }: { lang: Lang; done: () => void }) {
  const da = lang === "da";
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    let r; try { r = await callFn("invite-email", { email }); } catch { r = { status: 0, data: null as any }; }
    setBusy(false);
    if (r.status === 200) { setMsg({ ok: true, text: da ? `Invitationen er sendt til ${email}. Du får en kopi på mail.` : `Invitation sent to ${email}. You will get a copy by email.` }); setEmail(""); done(); }
    else setMsg({ ok: false, text: r.data?.error === "rate_limited" ? (da ? "Du har sendt mange invitationer i dag. Prøv igen i morgen." : "Too many invitations today.")
      : r.data?.error === "bad_input" ? (da ? "Tjek e-mailadressen." : "Check the email address.") : (da ? "Mailen kunne ikke sendes. Prøv igen senere." : "The email could not be sent. Try again later.") });
  };
  return (
    <form onSubmit={submit}>
      <p className="meta">{da ? "Der oprettes en ny samtale mellem jer to. Den inviterede ser kun beskeder fra efter, hun eller han er kommet med." : "A new conversation is created for the two of you. The invitee only sees messages from after joining."}</p>
      <label htmlFor="ie">{da ? "E-mail" : "Email"}</label><input id="ie" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="row end"><button type="submit" disabled={busy}>{busy ? (da ? "Sender…" : "Sending…") : "Send invitation"}</button></div>
      {msg && <p className={msg.ok ? "meta" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </form>
  );
}

function highlight(text: string, spans: string[]) {
  if (!spans.length) return text;
  const parts: (string | React.ReactElement)[] = []; let rest = text; let k = 0;
  for (const s of spans) { const i = rest.indexOf(s); if (i < 0) continue; parts.push(rest.slice(0, i), <mark key={k++}>{s}</mark>); rest = rest.slice(i + s.length); }
  parts.push(rest); return parts;
}

function AliasEdit({ lang, other, saved }: { lang: Lang; other: Other; saved: (a: string | null) => void }) {
  const da = lang === "da";
  const [edit, setEdit] = useState(false); const [v, setV] = useState(other.alias ?? ""); const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { error } = await supabase.rpc("set_contact_alias", { p_contact: other.user_id, p_alias: v });
    if (error) { setErr(da ? "Kaldenavnet kunne ikke gemmes." : "Could not save nickname."); return; }
    setEdit(false); saved(v.trim() || null);
  };
  if (!edit) return (<span className="alias">{labelOf(other)}{" "}
    <button type="button" className="ghost pencil" aria-label={da ? `Giv ${other.email} et privat kaldenavn` : `Set a private nickname for ${other.email}`} title={da ? "Privat kaldenavn" : "Private nickname"} onClick={() => { setV(other.alias ?? ""); setEdit(true); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
    </button></span>);
  return (
    <form onSubmit={save} className="alias-form" style={{ fontSize: 16, fontWeight: 400 }}>
      <label htmlFor={`al-${other.user_id}`}>{da ? `Privat kaldenavn for ${other.email}` : `Private nickname for ${other.email}`}</label>
      <input id={`al-${other.user_id}`} maxLength={40} value={v} onChange={(e) => setV(e.target.value)} placeholder={other.email} autoFocus />
      <p className="meta" style={{ margin: "4px 0" }}>{da ? "Kun du kan se det. Lad feltet stå tomt for at vise e-mailen." : "Only you can see it. Leave empty to show the email."}</p>
      <div className="row"><button type="submit">{da ? "Gem" : "Save"}</button><button type="button" className="ghost" onClick={() => setEdit(false)}>{da ? "Annuller" : "Cancel"}</button></div>
      {err && <p className="err" role="alert">{err}</p>}
    </form>);
}

type Pending = { id: string; role: string; invitee_email: string | null; consents: number; required: number; i_consented: boolean; mine: boolean };

function markAll(text: string, q: string, current: boolean): (string | React.ReactElement)[] | string {
  const n = q.trim(); if (!n) return text;
  const lo = text.toLocaleLowerCase(), nl = n.toLocaleLowerCase(); const out: (string | React.ReactElement)[] = []; let i = 0, k = 0;
  for (let j = lo.indexOf(nl); j >= 0; j = lo.indexOf(nl, i)) { out.push(text.slice(i, j), <mark key={k++} className={current ? "cur" : ""}>{text.slice(j, j + n.length)}</mark>); i = j + n.length; }
  out.push(text.slice(i)); return out;
}

const Icon = ({ d }: { d: React.ReactNode }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{d}</svg>;

function Chat({ lang, conv, back, menu }: { lang: Lang; conv: Conv; back: () => void; menu: MenuItem[] }) {
  const [others, setOthers] = useState<Other[]>(conv.others ?? []); const [color, setColor] = useState<string | null>(conv.color);
  const t = strings[lang]; const da = lang === "da";
  const draftKey = `draft:${conv.id}`;
  const [msgs, setMsgs] = useState<Msg[]>([]); const [pending, setPending] = useState(0);
  const [invs, setInvs] = useState<Pending[]>([]);
  const [text, setText] = useState(localStorage.getItem(draftKey) ?? "");
  const [status, setStatus] = useState<{ kind: string; spans?: string[]; blockedText?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [q, setQ] = useState<string | null>(null); const [cur, setCur] = useState(0);
  const endRef = useRef<HTMLDivElement>(null); const listRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_messages", { conv: conv.id }); if (data) setMsgs(data as Msg[]);
    const p = await supabase.rpc("my_pending_count"); setPending((p.data as number) ?? 0);
    const i = await supabase.rpc("list_pending_invitations", { conv: conv.id }); setInvs((i.data as Pending[]) ?? []);
  }, [conv.id]);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);
  useEffect(() => { if (q === null) endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  useEffect(() => { localStorage.setItem(draftKey, text); }, [text, draftKey]);
  const hits = q ? findHits(msgs.map((m) => m.body), q) : [];
  const curIdx = hits.length ? hits[Math.min(cur, hits.length - 1)] : -1;
  useEffect(() => { if (curIdx >= 0) listRef.current?.querySelector(`[data-i="${curIdx}"]`)?.scrollIntoView({ block: "center" }); }, [curIdx, q]);
  const send = async () => {
    if (!text.trim() || count(text) > MAX) return;
    setBusy(true); setStatus(null);
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
  const receiveNow = async () => { await callFn("receive-now", {}); load(); };
  const answer = async (id: string, action: "consent" | "decline") => { await callFn("invite-email", { action, invitation_id: id }); load(); };
  const n = count(text);
  const label = others.length ? others.map(labelOf).join(", ") : "?";
  const roleTxt = (r: string) => r === "reader" ? (da ? "kun læse" : "read only") : (da ? "læse og skrive" : "read and write");
  return (
    <>
      <header className="topbar chat">
        <button className="icon" onClick={back} aria-label={t.back}><Icon d={<path d="M15 18l-6-6 6-6" />} /></button>
        <ColorDot lang={lang} conv={{ ...conv, color }} label={label} changed={setColor} />
        <div role="heading" aria-level={2} className="chattitle">{others.length ? others.map((o) => <AliasEdit key={o.user_id} lang={lang} other={o} saved={(a) => { setOthers(others.map((x) => x.user_id === o.user_id ? { ...x, alias: a } : x)); load(); }} />) : convLabel(conv, da)}</div>
        <button className="icon" aria-label={da ? "Søg i samtalen" : "Search conversation"} aria-pressed={q !== null} onClick={() => { setQ(q === null ? "" : null); setCur(0); }}><Icon d={<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>} /></button>
        {conv.role === "parent" && <button className="icon" aria-label={da ? "Tilføj person" : "Add person"} onClick={() => setSheet("addMember")}><Icon d={<><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6" /><path d="M19 8v6M16 11h6" /></>} /></button>}
        <Menu lang={lang} items={[{ label: da ? "Eksportér samtale" : "Export conversation", run: () => setSheet("export") }, ...menu]} />
      </header>
      {q !== null && <div className="searchbar" role="search">
        <input type="search" autoFocus aria-label={da ? "Søg i viste beskeder" : "Search visible messages"} placeholder={da ? "Søg i viste beskeder" : "Search visible messages"} value={q} onChange={(e) => { setQ(e.target.value); setCur(0); }}
          onKeyDown={(e) => { if (e.key === "Enter" && hits.length) setCur((cur + (e.shiftKey ? hits.length - 1 : 1)) % hits.length); }} />
        <span className="meta count" aria-live="polite">{q.trim() ? (hits.length ? `${Math.min(cur, hits.length - 1) + 1}/${hits.length}` : "0/0") : ""}</span>
        <button className="icon" aria-label={da ? "Forrige" : "Previous"} disabled={!hits.length} onClick={() => setCur((cur + hits.length - 1) % hits.length)}><Icon d={<path d="M6 15l6-6 6 6" />} /></button>
        <button className="icon" aria-label={da ? "Næste" : "Next"} disabled={!hits.length} onClick={() => setCur((cur + 1) % hits.length)}><Icon d={<path d="M6 9l6 6 6-6" />} /></button>
        <button className="icon" aria-label={da ? "Luk søgning" : "Close search"} onClick={() => setQ(null)}>✕</button>
      </div>}
      {invs.map((iv) => <div key={iv.id} className="notice invite-pending" role="status">
        <div><strong>{iv.invitee_email}</strong> · {roleTxt(iv.role)}</div>
        <div className="meta">{da ? `Afventer godkendelse: ${iv.consents} af ${iv.required} har godkendt. Ét afslag stopper invitationen.` : `Awaiting approval: ${iv.consents} of ${iv.required} approved. One rejection stops it.`}</div>
        {!iv.i_consented ? <div className="row end"><button className="ghost" onClick={() => answer(iv.id, "decline")}>{da ? "Afvis" : "Reject"}</button><button onClick={() => answer(iv.id, "consent")}>{da ? "Godkend" : "Approve"}</button></div>
          : iv.mine ? <div className="row end"><button className="ghost" onClick={() => answer(iv.id, "decline")}>{da ? "Træk tilbage" : "Withdraw"}</button></div> : null}
      </div>)}
      {pending > 0 && <div className="notice row"><span>{t.pending(pending)}</span><span className="spacer" /><button onClick={receiveNow}>{t.receiveNow}</button></div>}
      <div className="card msgs" aria-live="polite" ref={listRef}>
        {msgs.length === 0 && <p className="meta">{t.empty}</p>}
        {msgs.map((m, i) => <div key={m.id} data-i={i} className={`msg ${m.mine ? "mine" : "theirs"}${i === curIdx ? " hit" : ""}`}><div className="meta">{m.mine ? t.you : m.sender_name} · {new Date(m.created_at).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" })}</div>{q ? markAll(m.body, q, i === curIdx) : m.body}</div>)}
        <div ref={endRef} />
      </div>
      {status?.kind === "blocked" && <div className="notice" role="alert"><p style={{ margin: 0 }}>{t.blocked}</p>{status.spans!.length > 0 && <p className="meta" style={{ marginBottom: 0 }}>{t.flagged}: {highlight(status.blockedText!, status.spans!)}</p>}</div>}
      {status && status.kind !== "blocked" && <div className={status.kind === "accepted" ? "notice" : "err"} role="status">{(t as any)[status.kind]}</div>}
      {conv.role !== "reader" ? (
        <div className="card composer">
          <textarea aria-label={t.write} placeholder={t.write} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row"><span className="meta" style={{ color: n > MAX ? "crimson" : undefined }}>{n}/{MAX}</span><span className="spacer" /><button onClick={send} disabled={busy || !text.trim() || n > MAX}>{busy ? t.sending : t.send}</button></div>
        </div>) : <p className="meta">{t.readOnly}</p>}
      {sheet === "export" && <SheetView title={da ? "Eksportér samtale" : "Export conversation"} close={() => setSheet(null)} lang={lang}><ExportPanel lang={lang} msgs={msgs} /></SheetView>}
      {sheet === "addMember" && <SheetView title={da ? "Tilføj person" : "Add person"} close={() => setSheet(null)} lang={lang}><AddMember lang={lang} conv={conv.id} done={load} /></SheetView>}
    </>
  );
}

function AddMember({ lang, conv, done }: { lang: Lang; conv: string; done: () => void }) {
  const da = lang === "da";
  const [email, setEmail] = useState(""); const [role, setRole] = useState("reader"); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    let r; try { r = await callFn("invite-email", { action: "member", conversation_id: conv, email, role }); } catch { r = { status: 0, data: null as any }; }
    setBusy(false);
    if (r.status === 200) { setMsg({ ok: true, text: r.data?.data?.status === "sent" ? (da ? `Invitationen er sendt til ${email}.` : `Invitation sent to ${email}.`) : (da ? "Anmodningen er sendt. De øvrige i samtalen skal godkende, før personen inviteres." : "Request sent. The others must approve before the person is invited.") }); setEmail(""); done(); }
    else setMsg({ ok: false, text: r.data?.error === "rate_limited" ? (da ? "Du har sendt mange invitationer i dag." : "Too many invitations today.") : r.data?.error === "bad_input" ? (da ? "Tjek e-mailadressen. Personen må ikke allerede være med." : "Check the email. The person must not already be a member.") : (da ? "Invitationen kunne ikke oprettes." : "The invitation could not be created.") });
  };
  return (
    <form onSubmit={submit}>
      <p className="meta">{da ? "Fx advokat eller sagsbehandler. Personen får først adgang, når alle i samtalen har godkendt. Ét afslag stopper det. Personen ser ingen beskeder fra før." : "E.g. a lawyer or caseworker. Access only after everyone approves. One rejection stops it. No earlier history is shown."}</p>
      <label htmlFor="me">{da ? "E-mail" : "Email"}</label><input id="me" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label>{da ? "Rolle" : "Role"}</label>
      <Choice name="role" value={role} set={setRole} opts={[["reader", da ? "Kun læse" : "Read only"], ["writer", da ? "Læse og skrive" : "Read and write"]]} />
      <div className="row end"><button type="submit" disabled={busy}>{busy ? (da ? "Sender…" : "Sending…") : (da ? "Send til godkendelse" : "Send for approval")}</button></div>
      {msg && <p className={msg.ok ? "meta" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </form>
  );
}

function download(name: string, blob: Blob) {
  const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}

function ExportPanel({ lang, msgs }: { lang: Lang; msgs: Msg[] }) {
  const da = lang === "da"; const [busy, setBusy] = useState(false);
  const build = async () => {
    const { data } = await supabase.auth.getUser(); const me = data.user?.email ?? "";
    const rows: Row[] = msgs.map((m) => ({ sender: m.mine ? me : (m.sender_name ?? ""), time: new Date(m.created_at).toLocaleString(lang === "da" ? "da-DK" : "en-GB", { dateStyle: "short", timeStyle: "short" }), text: m.body }));
    return { me, rows, at: new Date().toLocaleString(lang === "da" ? "da-DK" : "en-GB", { dateStyle: "long", timeStyle: "short" }) };
  };
  const csv = async () => { const { me, rows, at } = await build(); download(exportFileName("csv"), new Blob([toCsv(rows, me, at, lang)], { type: "text/csv;charset=utf-8" })); };
  const pdf = async () => {
    setBusy(true);
    const { me, rows, at } = await build(); const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" }); const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48; let y = M;
    const line = (txt: string, size: number, bold = false, gap = 4) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
      for (const l of doc.splitTextToSize(txt, W - 2 * M) as string[]) { if (y > H - M) { doc.addPage(); y = M; } doc.text(l, M, y); y += size * 1.3; } y += gap; };
    line(da ? "Rolff – eksporteret samtale" : "Rolff – exported conversation", 16, true);
    line(da ? `Eksporteret af ${me} den ${at}` : `Exported by ${me} on ${at}`, 10, false, 2);
    line(da ? "Indeholder kun beskeder, du selv har adgang til. Testmiljø – opdigtede beskeder." : "Contains only messages you have access to. Test environment – made-up messages.", 9, false, 14);
    for (const r of rows) { line(`${r.sender} · ${r.time}`, 9, true, 0); line(r.text, 11, false, 10); }
    doc.save(exportFileName("pdf")); setBusy(false);
  };
  return (
    <div>
      <p className="meta">{da ? `Eksporten indeholder de ${msgs.length} beskeder, du kan se nu: dine egne og dem, der er leveret til dig. Filen laves på din enhed.` : `The export contains the ${msgs.length} messages you can see now: your own and those delivered to you. The file is created on your device.`}</p>
      <div className="row end"><button className="ghost" onClick={csv} disabled={!msgs.length}>CSV</button><button onClick={pdf} disabled={busy || !msgs.length}>PDF</button></div>
    </div>
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
  const upd = (i: number, p: Partial<W>) => { setWs(ws.map((x, j) => j === i ? { ...x, ...p } : x)); setMsg(""); };
  const tzs = TZS.includes(tz) ? TZS : [tz, ...TZS];
  return (
    <div className="times">
      <label className="switch"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>{t.windowsOn}</span></label>
      <label htmlFor="tz">{t.tz}</label><select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>{tzs.map((z) => <option key={z}>{z}</option>)}</select>
      <div className="wlist">
        {ws.map((w, i) => (
          <div className="wrow" key={i}>
            <select aria-label={lang === "da" ? "Dag" : "Day"} value={w.weekday} onChange={(e) => upd(i, { weekday: +e.target.value })}>{t.days.map((d, k) => <option key={k} value={k + 1}>{d}</option>)}</select>
            <input type="time" aria-label={t.from} value={toHM(w.start_minute)} onChange={(e) => upd(i, { start_minute: fromHM(e.target.value) })} />
            <span className="dash" aria-hidden="true">–</span>
            <input type="time" aria-label={t.to} value={toHM(w.end_minute)} onChange={(e) => upd(i, { end_minute: fromHM(e.target.value) })} />
            <button type="button" className="icon rm" aria-label={`${t.remove} ${t.days[w.weekday - 1]} ${toHM(w.start_minute)}–${toHM(w.end_minute)}`} onClick={() => { setWs(ws.filter((_, j) => j !== i)); setMsg(""); }}>
              <Icon d={<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>} />
            </button>
          </div>))}
      </div>
      <div className="row"><button className="ghost" onClick={() => setWs([...ws, { weekday: 1, start_minute: 17 * 60, end_minute: 20 * 60 }])}>+ {t.add}</button><span className="spacer" /><span className="meta" role="status">{msg}</span><button onClick={save}>{t.save}</button></div>
    </div>
  );
}

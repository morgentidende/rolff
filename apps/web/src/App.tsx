import { BlockingLists } from "./BlockingLists";
import { resetBackNavigation, useBackLayer, useBackNavigationRoot, usePanelState } from "./backNavigation";
import { ReceiveSettings } from "./ReceiveSettings";
import { setReceiveTimezoneUser, syncReceiveTimezone } from "./receiveTimezone";
import { ContactAliasDialog, ContactButton } from "./ContactAlias";
import { ComposerInput } from "./ComposerInput";
import { effectiveCharLimit, textRetryKey } from "./composerLimits";
import { MessageBubble, ReplyComposer, type Message } from "./MessageBubble";
import { Toast } from "./toast";
import { rectOf, useAnchoredPlacement, visibleViewport } from "./anchoredPosition";
import type React from "react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { callFn, supabase } from "./supabase";
import { detectLang, strings, type Lang } from "./i18n";
import { passwordsMatch, pwText, toggleLabel } from "./pw";
import { cacheClear, cacheGet, cacheSet } from "./localStore";
import { LunaIndicator } from "./LunaRobot";
import { applySuggestion } from "./suggestion";
import { KEY as A2HS_KEY, platform as a2hsPlatform, shouldAsk } from "./install";
import { makeZip, myDataFiles, findHits } from "./exportUtil";
import { ConversationExport } from "./ConversationExport";
import { EventNotice, eventsBefore, useConversationEvents } from "./ConversationEvents";

import { labelOf, convDisplay } from "./convDisplay";

type Other = { user_id: string; email: string; alias: string | null };
type Conv = { id: string; role: string; members: number; others: Other[]; color: string | null; pending_invitee?: string | null };
const convLabel = (c: Conv, da: boolean) => convDisplay(c, da).title;
type Msg = Message;
const count = (s: string) => [...s].length;

type Peek = { inviter_email: string; invitee_email: string; expires_at: string };
// Invite link: #invite=TOKEN. Kept in sessionStorage until accepted, then removed from URL.
function readInviteToken(): string | null {
  const m = location.hash.match(/invite=([0-9a-f]{16,128})/);
  if (m) { sessionStorage.setItem("invite", m[1]); history.replaceState(history.state, "", location.pathname + location.search); }
  return sessionStorage.getItem("invite");
}

type Sheet = "members" | "privacy" | "words" | null | "lang" | "theme" | "times" | "faq" | "feedback" | "invite" | "export" | "addMember" | "name" | "report" | "account" | "newpw" | "plans";
export type MenuItem = { label: string; run: () => void; danger?: boolean };

export function App() {
  const [inviteToken, setInviteToken] = useState<string | null>(() => readInviteToken());
  const [peek, setPeek] = useState<Peek | null | undefined>(undefined);
  const [inviteMsg, setInviteMsg] = useState("");
  const [lang, setLang] = useState<Lang>(detectLang());
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [session, setSession] = useState<Session | null>(null);
  const [conv, setConv] = useState<Conv | null>(null);
  const [sheet, setSheet, resetSheet] = usePanelState<Sheet>(null);
  const [homeKey, setHomeKey] = useState(0);
  const [renameContacts, setRenameContacts] = useState<Other[] | null>(null);
  useEffect(() => { setRenameContacts(null); }, [session?.user.id]);
  const t = strings[lang]; const da = lang === "da";
  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    localStorage.setItem("theme", theme);
    const apply = () => { const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; };
    apply(); const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    let uid:string|null=null, active=true, observed=0;
    const apply=(s:Session|null)=>{if(!active)return;const next=s?.user.id??null;setReceiveTimezoneUser(next);if(uid!==next){resetBackNavigation();setConv(null);resetSheet();setRenameContacts(null);uid=next;}setSession(s);};
    const { data } = supabase.auth.onAuthStateChange((event, s) => {if(event==="INITIAL_SESSION"&&observed)return;observed++;apply(s);});
    const start=observed;
    supabase.auth.getSession().then(({ data }) => {if(observed===start)apply(data.session);});
    return () => {active=false;data.subscription.unsubscribe();};
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
        : (da ? "Invitationen kunne ikke bruges. Den kan være udløbet, brugt eller sendt til en anden e-mail. Er der kommet en ny deltager i samtalen, skal den også godkende – så får du en ny mail med et nyt link." : "The invitation could not be used. It may be expired, used, or meant for another email. If someone new joined the conversation, they must approve too – you will then get a new email with a new link."));
    });
  }, [session, inviteToken]);
  useEffect(() => {
    const q = new URLSearchParams(location.search), type = q.get("auth"), th = q.get("th");
    if (!type || !th) return;
    history.replaceState(history.state, "", location.pathname);
    if (type !== "recovery" && type !== "email_change") return;
    supabase.auth.verifyOtp({ token_hash: th, type }).then(({ error }) => {
      if (error) { setInviteMsg(da ? "Linket er ugyldigt eller udløbet. Bed om et nyt." : "The link is invalid or expired. Request a new one."); return; }
      if (type === "recovery") setSheet("newpw");
      else setInviteMsg(da ? "Bekræftet. Din e-mail er skiftet." : "Confirmed. Your email has been changed.");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (session) supabase.rpc("touch_seen").then(() => {}); }, [session]);
  useEffect(() => {
    const uid=session?.user.id; if(!uid)return;
    const sync=()=>{if(document.visibilityState!=="hidden")void syncReceiveTimezone(uid,true);};
    sync();window.addEventListener("focus",sync);window.addEventListener("online",sync);document.addEventListener("visibilitychange",sync);
    return()=>{window.removeEventListener("focus",sync);window.removeEventListener("online",sync);document.removeEventListener("visibilitychange",sync);};
  },[session?.user.id]);
  const menu: MenuItem[] = [
    { label: t.lang, run: () => setSheet("lang") },
    { label: t.theme, run: () => setSheet("theme") },
    { label: t.windows, run: () => setSheet("times") },
    { label: "FAQ", run: () => setSheet("faq") },
    { label: da ? "Abonnement" : "Plan", run: () => setSheet("plans") },
    { label: conv ? (da ? "Kontaktens kaldenavn" : "Contact nickname") : (da ? "Mit visningsnavn" : "My display name"), run: () => conv ? setRenameContacts(conv.others) : setSheet("name") },
    { label: da ? "Konto (e-mail og adgangskode)" : "Account (email and password)", run: () => setSheet("account") },
    { label: da ? "Privatliv og sletning" : "Privacy and deletion", run: () => setSheet("privacy") },
    { label: da ? "Privatlivspolitik" : "Privacy policy", run: () => { window.open("./privatliv.html" + (da ? "" : "#en"), "_blank", "noopener"); } },
    { label: "Feedback", run: () => setSheet("feedback") },
    { label: da ? "Inviter person" : "Invite person", run: () => setSheet("invite") },
    { label: t.logout, run: () => { resetBackNavigation(); setConv(null); resetSheet(); cacheClear().finally(() => supabase.auth.signOut()); }, danger: true },
  ];
  const close = () => setSheet(null);
  useBackNavigationRoot();
  useBackLayer(!!conv,()=>setConv(null),"view");
  useBackLayer(!!renameContacts,()=>setRenameContacts(null));
  return (
    <div className={session && conv ? "wrap chat-wrap" : "wrap"}>
      {!(session && conv) && <header className="topbar"><img src="./favicon.svg" alt="" width={30} height={30} style={{ borderRadius: 8 }} /><strong className="brand">Rolff</strong><span className="spacer" />
        {session ? <Menu lang={lang} items={menu} /> : <>
          <select aria-label={t.lang} className="compact" value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="da">Dansk</option><option value="en">English</option></select>
          <select aria-label={t.theme} className="compact" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></>}
      </header>}
      <div className="notice" role="note">{t.testNotice}</div>
      {inviteMsg && <div className="notice" role="status">{inviteMsg}</div>}
      {session && !conv && <InstallPrompt lang={lang} />}
      {!session ? <Auth lang={lang} peek={inviteToken ? peek : undefined} />
        : conv ? <Chat session={session} key={session.user.id} lang={lang} conv={conv} rename={setRenameContacts} back={() => setConv(null)} menu={menu} openPlans={() => setSheet("plans")} planKey={sheet} />
        : <Home key={`home:${session.user.id}`} refreshKey={homeKey} lang={lang} open={setConv} rename={setRenameContacts} invite={() => setSheet("invite")} />}
      {sheet === "lang" && <SheetView title={t.lang} close={close} lang={lang}><Choice name="lang" value={lang} set={(v) => setLang(v as Lang)} opts={[["da", "Dansk"], ["en", "English"]]} /></SheetView>}
      {sheet === "theme" && <SheetView title={t.theme} close={close} lang={lang}><Choice name="theme" value={theme} set={setTheme} opts={[["dark", t.dark], ["light", t.light], ["system", t.system]]} /></SheetView>}
      {sheet === "times" && <SheetView title={t.windows} close={close} lang={lang}><ReceiveSettings key={session?.user.id??"anonymous"} lang={lang} /></SheetView>}
      {sheet === "plans" && <SheetView title={da ? "Abonnement" : "Plan"} close={close} lang={lang}><Plans lang={lang} /></SheetView>}
      {sheet === "faq" && <SheetView title="FAQ" close={close} lang={lang}><Faq lang={lang} /></SheetView>}
      {sheet === "name" && <SheetView title={da ? "Mit navn – det andre ser" : "My name – visible to others"} close={close} lang={lang}><PublicName lang={lang} /></SheetView>}
      {session && renameContacts && <ContactAliasDialog key={`alias:${session.user.id}`} lang={lang} contacts={renameContacts}
        close={() => setRenameContacts(null)} save={async (id, alias) => { const uid=session.user.id; const { error } = await supabase.rpc("set_contact_alias", { p_contact: id, p_alias: alias }).setHeader("Authorization", `Bearer ${session.access_token}`); if (error) throw error; if((await supabase.auth.getSession()).data.session?.user.id!==uid)return; const name=alias.trim()||null; setConv(c => c ? { ...c, others: c.others.map(o => o.user_id === id ? { ...o, alias:name } : o) } : c); setHomeKey(k => k + 1); }}
        saved={() => setRenameContacts(null)} />}
      {session && !sheet && !renameContacts && <NameHint lang={lang} open={() => setSheet("name")} />}
      {sheet === "account" && <SheetView title={da ? "Konto" : "Account"} close={close} lang={lang}><AccountPanel lang={lang} /></SheetView>}
      {sheet === "newpw" && session && <SheetView title={da ? "Vælg ny adgangskode" : "Choose a new password"} close={close} lang={lang}><NewPassword lang={lang} done={close} /></SheetView>}
      {sheet === "privacy" && <SheetView title={da ? "Privatliv og sletning" : "Privacy and deletion"} close={close} lang={lang}><PrivacyPanel lang={lang} /></SheetView>}
      {sheet === "feedback" && <SheetView title="Feedback" close={close} lang={lang}><FeedbackForm lang={lang} /></SheetView>}
      {sheet === "invite" && <SheetView title={da ? "Inviter person" : "Invite person"} close={close} lang={lang}><InviteByEmail lang={lang} done={() => setHomeKey(homeKey + 1)} /></SheetView>}
    </div>
  );
}

function Menu({ lang, items }: { lang: Lang; items: MenuItem[] }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useBackLayer(open,()=>setOpen(false));
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", off); };
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

function SheetView({ title, close, lang, children, anchor }: { title: string; close: () => void; lang: Lang; children: React.ReactNode; anchor?: React.RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useBackLayer(true,close);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  // Anchored variant: a dropdown card right under its top-bar icon, kept inside
  // the visible viewport (visualViewport shrinks when the mobile keyboard opens).
  const { pos } = useAnchoredPlacement(!!anchor, () => {
    const r = rectOf(anchor?.current);
    if (r && r.right > r.left) return r;
    const v = visibleViewport(); return { top: v.top + 48, bottom: v.top + 48, left: v.left + v.width - 12, right: v.left + v.width - 12 };
  }, ref, { align: "end", flip: false, gap: 6, margin: 12, minVisible: 120 });
  useEffect(() => {
    const v = window.visualViewport;
    if (!anchor || !v) return;
    const keep = () => { const a = document.activeElement as HTMLElement | null; if (a && a !== ref.current && ref.current?.contains(a)) requestAnimationFrame(() => a.scrollIntoView?.({ block: "nearest" })); };
    v.addEventListener("resize", keep); return () => v.removeEventListener("resize", keep);
  }, [anchor]);
  const style: React.CSSProperties | undefined = !anchor ? undefined : pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight, maxWidth: pos.maxWidth } : { top: 0, left: 0, visibility: "hidden" };
  return (
    <div className={anchor ? "overlay anchored-overlay" : "overlay"} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={anchor ? "sheet anchored-card" : "sheet"} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={style}>
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
    ["Hvad gør AI-tonetjekket?", "Før en besked sendes, vurderer en AI-tjeneste tonen og om den dikterer, hvad den anden skal gøre. Bliver den afvist, leveres den ikke. Har beskeden et konkret legitimt praktisk ønske, kan du få et valgfrit omformuleringsforslag; ellers kun vejledning (ikke sendbar). Beskeden og korte uddrag (højst 300 tegn) af op til 5 tidligere beskeder sendes til tjenesten. I testen: kun opdigtede beskeder."],
    ["Hvad er modtagetider?", "Du kan vælge, hvornår på ugen nye beskeder når frem til dig. Beskeder, der kommer uden for dine tider, venter, til næste modtagetid – eller til du selv trykker “Modtag beskeder nu”."],
    ["Hvordan kommer man ind i en samtale?", "Kun via invitation på e-mail. Ekstra deltagere (fx advokat eller sagsbehandler) får først adgang, når alle i samtalen har godkendt, og de ser ingen beskeder fra før, de kom med."],
    ["Hvem kan se og skrive i samtalen?", "Under ⋮ → “Deltagere og roller” ser du alle deltagere og deres rolle: Part, Læse og skrive eller Kun læse. Parterne kan fjerne ekstra deltagere eller gøre en skrivende deltager til kun læse. Skriveadgang kræver en ny invitation, som alle parter godkender. Alle kan forlade samtalen."],
    ["Hvad bliver blokeret?", "Rolff stopper beskeder, der kan opfattes som sårende (tjekket af AI), beskeder der dikterer hvad den anden skal gøre (fx «du skal …» som en ordre – ikke venlige anmodninger, spørgsmål, egen grænsesætning eller neutrale citater), beskeder med emojis (de misforstås let – skriv det med ord), beskeder skrevet med store bogstaver (opleves som råb) og den samme besked sendt igen. Ved AI-/tone-afvisning kan du få et valgfrit forslag, hvis beskeden indeholder et konkret, legitimt praktisk ønske («Brug forslaget» kopierer det til skrivefeltet; du redigerer og sender selv, og det tjekkes igen). Ren kritik, trusler uden praktisk kerne eller lignende kan ikke omformuleres — så får du kun vejledning (ikke en sendbar tekst). Forslag erstatter ikke ordblokliste, længde- eller frekvensgrænser. Stavefejl og ukendte egenavne er ikke i sig selv et problem. Hvis AI er usikker på beskedens afgørende mening, bliver du bedt om at præcisere den, før den kan sendes. Store begyndelsesbogstaver gør ikke krænkende ord til tilladte navne."],
    ["Hvordan blokerer jeg en samtale?", "Tryk ⋮ i samtalen → “Blokér samtale”. Så kan de andre ikke længere sende beskeder i samtalen; de får kun at vide, at beskeden ikke kan sendes – ikke hvem eller hvornår. Blokeringen udløber aldrig af sig selv. Den ophører kun, når du selv trykker “Afblokér”."],
    ["Hvad er “Blokerede ord”?", "Et valgfrit filter (slået fra som standard): Under ⋮ → “Blokerede ord” kan du tilføje enkeltord, udtryk på flere ord eller hele sætninger (op til 120 tegn), som ikke må nå frem til dig. Store/små bogstaver og accenter er ligegyldige (fx matcher “dårlig far” også “DÅRLIG FAR” og “darlig far”), og ordene skal stå i samme rækkefølge. Afslutter du med * (fx “pis*”), rammes også ord, der begynder sådan. Listen gælder den samtale, du står i, og er privat. Rammer en besked noget på listen, bliver den ikke leveret – afsenderen får at vide præcis hvilket ord eller udtryk, og at modtageren har blokeret det, og kan omformulere. Derfor skal du bekræfte det for hvert ord. Du kan fjerne ord igen når som helst."],
    ["Kan jeg begrænse hvor tit en person skriver?", "Ja. Åbn “Deltagere og roller” og derefter “Indstillinger for denne person”. Vælg højst 1 besked pr. minut, pr. 5 minutter, pr. time eller et brugerdefineret antal minutter (1 til 1.440 = 24 timer). Standard er ingen grænse. Det regnes fra personens seneste leverede besked til dig i alle jeres samtaler; afviste beskeder tæller ikke, vedhæftninger tæller som en besked. For tidlige beskeder gemmes ikke, og afsenderen får at vide, hvornår der kan sendes igen. Er I flere, gælder den strengeste grænse."],
    ["Hvem kan tilføje en ekstra person til en samtale?", "At invitere den anden forælder, når du opretter en samtale, kan alle. At tilføje en ekstra person (fx advokat eller bedsteforælder) kræver, at DU som inviterer har planen “Tekst + vedhæftninger” (79 kr./md.). De andre deltagere og den inviterede må gerne have 49-planen. Nedgraderer du senere, bliver de nuværende deltagere."],
    ["Hvad kan de andre se om mig?", "Du logger ind med din e-mail. Som udgangspunkt er din e-mail også det navn, de andre i samtalen ser. Du kan når som helst vælge et kaldenavn under ⋮ → Visningsnavn – så ser de kun kaldenavnet, også i eksisterende samtaler, og din e-mail udleveres ikke længere til dem. Hver person kan desuden give dig et privat kaldenavn, som kun de selv ser. Glemt adgangskode: brug linket på login-siden. Skift e-mail eller adgangskode: ⋮ → Konto. Sletning af konto: ⋮ → Privatliv og sletning."],
    ["Hvordan rapporterer jeg noget?", "Tryk ⋮ i samtalen → “Rapportér”. Du vælger kategori, skriver selv hvad der er sket og kan markere de beskeder, du vil vedhæfte. Du ser en forhåndsvisning, og intet sendes før du bekræfter. Rapporten mailes til Rolffs udvikler (kontakt: nicolaipetersen108@gmail.com) med dit kaldenavn og bruger-id. Rolff gemmer kun kategori, tidspunkt og antal vedhæftede beskeder (til at begrænse misbrug) – ikke teksten. Der er ingen døgnvagt og ingen garanti for svar eller handling. Ved akut fare: ring 112."],
    ["Hvor ligger mine data, og hvor længe?", "På Supabase-servere i Frankfurt (EU). Du vælger selv opbevaring (1 år, 5 år eller ubegrænset) og sky-synk under ⋮ → Privatliv og sletning. Der kan du også downloade alle dine data (ZIP med JSON og CSV) og slette din konto. AI-tonetjekket bruger i testen OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; store:false). Læs mere i privatlivspolitikken (⋮ → Privatlivspolitik)."],
    ["Kan jeg sende billeder og PDF'er?", "Ja, med planen “Tekst + vedhæftninger” (79 kr./md.). Brug papirclipsen til filvalg eller kameraikonet til et nyt billede. Telefonen styrer eventuelle kameratilladelser, når funktionen bruges; filvælgeren giver kun adgang til den valgte fil. En valgt fil sendes først, når du trykker på papirflyet. Du kan sende PNG, JPG, WebP, GIF (ikke animeret) og PDF (højst 4 MB og 5 sider). Før filen sendes, tjekker AI (OpenAI, gpt-6-luna) både billedet og al tekst i det – samme regler som beskeder. Er bare én linje sårende, eller er billedet upassende, bliver filen ikke sendt, og du får at vide hvorfor. Modtagerens blokerede ord gælder også tekst i filen. Alle i samtalen kan se vedhæftninger, de modtager, uanset plan. Læsere kan ikke sende filer."],
    ["Hvad koster Rolff?", "Der er to planer: “Tekst” 49 kr./md. med højst 160 tegn pr. besked (én SMS-længde) og “Tekst + vedhæftninger” 79 kr./md. med højst 480 tegn (tre SMS-længder). Planen gælder dig som afsender, så to forældre kan have hver sin plan. Opgradering gælder straks, nedgradering fra næste periode. I testversionen er skiftet en testfunktion uden betaling."],
    ["Er det her den rigtige app?", "Nej, det er et testmiljø. Skriv kun opdigtede beskeder. AI-tjekket kører hos OpenAI (se ovenfor)."],
  ] : [
    ["Can the other person see if I read a message or am online?", "No. Rolff has no read receipts, no online status and no typing indicator."],
    ["What does the AI tone check do?", "Before a message is sent, an AI service assesses tone and whether it dictates what the other person must do. If rejected, it is not delivered. With a concrete legitimate practical wish you may get an optional rewrite; otherwise guidance only (not sendable). The message and short excerpts (max 300 characters) of up to 5 earlier messages are sent to the service. In the test: synthetic messages only."],
    ["What are receive times?", "You choose when during the week new messages reach you. Messages arriving outside your times wait until the next receive time – or until you tap “Receive messages now”."],
    ["How do people join a conversation?", "Only by e-mail invitation. Extra participants (e.g. a lawyer or caseworker) only get access when everyone in the conversation has approved, and they see no messages from before they joined."],
    ["Who can read and write in the conversation?", "Under ⋮ → “Participants and roles” you see everyone and their role: Party, Read and write or Read only. Parties can remove extra participants or make a writer read only. Write access needs a new invitation approved by all parties. Anyone can leave."],
    ["What gets blocked?", "Rolff stops messages that may come across as hurtful (checked by AI), messages that dictate what the other person must do (e.g. “you must …” as an order — not polite requests, questions, your own boundaries or neutral quotes), messages with emojis (easily misread – use words), messages in all caps (reads as shouting) and the same message sent twice. On AI/tone blocks you may get an optional rephrase only if the message contains a concrete legitimate practical wish (“Use suggestion” copies it into the composer; you edit and send yourself, and it is checked again). Pure criticism, threats without a practical core, and similar cannot be rewritten — you then get guidance only (not sendable text). Suggestions do not override blocked words, length or frequency limits. Spelling errors and unfamiliar proper names alone are not a problem. If AI cannot understand the core meaning sufficiently, you are asked to clarify before sending. Capitalizing offensive words does not exempt them as names."],
    ["How do I block a conversation?", "Tap ⋮ in the conversation → “Block conversation”. The others can then no longer send messages there; they are only told the message cannot be sent – not who or when. A block never expires by itself. It only ends when you tap “Unblock”."],
    ["What are “Blocked words”?", "An optional filter (off by default): under ⋮ → “Blocked words” you can add single words, multi-word expressions or whole sentences (up to 120 characters) that must not reach you. Case and accents are ignored, and words must appear in the same order. Ending with * (e.g. “pis*”) also matches words starting that way. The list applies to the current conversation and is private. If a message hits it, it is not delivered – the sender is told exactly which word or phrase and that the recipient blocked it, and can rephrase. That is why you confirm each word. You can remove words at any time."],
    ["Can I limit how often a person writes?", "Yes. Open “Participants and roles”, then “Settings for this person”. Choose at most 1 message per minute, per 5 minutes, per hour, or a custom number of minutes (1 to 1,440 = 24 hours). Default: no limit. It counts from the person's latest delivered message to you in any of your conversations; rejected messages do not count; attachments count as a message. Early messages are not stored and the sender is told when they can send again. With several recipients the strictest applies."],
    ["Who can add an extra person to a conversation?", "Anyone can invite the other parent when creating a conversation. Adding an extra person (e.g. a lawyer) requires that YOU, the inviter, are on “Text + attachments” (79 DKK/month). Other members and the invitee may be on 49. If you downgrade later, existing members stay."],
    ["What can others see about me?", "You log in with your e-mail. By default your e-mail is also the name others in the conversation see. You can choose a nickname at any time under ⋮ → Display name – then they only see the nickname, also in existing conversations, and your e-mail is no longer given to them. Each person can also give you a private nickname only they see. Forgot password: use the link on the login page. Change e-mail or password: ⋮ → Account. Account deletion: ⋮ → Privacy and deletion."],
    ["How do I report something?", "Tap ⋮ in the conversation → “Report”. You choose a category, write what happened and can tick the messages you want to attach. You see a preview and nothing is sent until you confirm. The report is e-mailed to Rolff's developer (contact: nicolaipetersen108@gmail.com) with your nickname and user id. Rolff stores only category, time and number of attached messages (to limit abuse) – not the text. There is no 24/7 staff and no guarantee of a reply or action. In an emergency: call 112."],
    ["Where is my data, and for how long?", "On Supabase servers in Frankfurt (EU). You choose retention (1 year, 5 years or unlimited) and cloud sync under ⋮ → Privacy and deletion, where you can also download all your data (ZIP with JSON and CSV) and delete your account. The AI tone check uses OpenAI during testing (US/global processing, not EU; no Zero Data Retention yet; store:false). See the privacy policy (⋮ → Privacy policy)."],
    ["Can I send images and PDFs?", "Yes, with the “Text + attachments” plan (79 DKK/month). Use the paperclip to choose a file or the camera to take a photo. Your phone manages any camera permission when used; the file picker grants access only to your chosen file. Nothing is sent until you press the paper plane. PNG, JPG, WebP, GIF (not animated) and PDF (max 4 MB, 5 pages). Before sending, AI (OpenAI, gpt-6-luna) checks the image and all text in it with the same rules as messages. If one line is hurtful or the image is inappropriate, it is not sent and you are told why. The recipient's blocked words also apply to text in the file. Everyone can view attachments they receive, whatever their plan. Readers cannot send files."],
    ["What does Rolff cost?", "Two plans: “Text” 49 DKK/month with up to 160 characters per message (one SMS length) and “Text + attachments” 79 DKK/month with up to 480 (three SMS lengths). The plan applies to you as sender, so two parents may have different plans. Upgrades apply immediately, downgrades from the next period. In the test version switching is a test feature without payment."],
    ["Is this the real app?", "No, this is a test environment. Write made-up messages only. The AI check runs at OpenAI (see above)."],
  ];
  return <div className="faq">{qa.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>;
}

export const evidenceNote = (lang: Lang) => lang === "da"
  ? "Vigtigt: Rolff er lavet til at kunne bruges som dokumentation. Det, du skriver og modtager, bliver hos de andre i samtalen – også hvis du senere sletter din konto. Du kan slette din egen kopi, men ikke kræve de andres slettet."
  : "Important: Rolff is designed to serve as a record. What you write and receive stays with the others in the conversation – even if you later delete your account. You can delete your own copy, but you cannot require the others' copy to be deleted.";

function MyDataExport({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [pw, setPw] = useState(""); const [st, setSt] = useState<"" | "busy" | "ok" | "wrong" | "limit" | "err">("");
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setSt("busy");
    let r; try { r = await callFn("export-data", { password: pw }); } catch { r = { status: 0, data: null as any }; }
    setPw("");
    if (r.status !== 200) { setSt(r.status === 403 ? "wrong" : r.status === 429 ? "limit" : "err"); return; }
    const zip = makeZip(myDataFiles(r.data.data));
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a"); a.href = url; a.download = `rolff-mine-data-${new Date().toISOString().slice(0, 10)}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000); setSt("ok");
  };
  return (
    <form onSubmit={go}>
      <h3 id="export">{da ? "Download mine data" : "Download my data"}</h3>
      <p className="meta">{da ? "En ZIP med JSON og CSV: konto, indstillinger, dine samtaler (det du selv kan se), egne kaldenavne, blokerede ord, invitationer, samtykker, feedback og metadata. Filen laves på din enhed. Højst 3 gange i døgnet." : "A ZIP with JSON and CSV: account, settings, your conversations (what you can see), own nicknames, blocked words, invitations, consents, feedback and metadata. Built on your device. At most 3 times a day."}</p>
      <label htmlFor="xpw">{da ? "Bekræft med din adgangskode" : "Confirm with your password"}</label>
      <input id="xpw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      <div className="row end"><button type="submit" disabled={st === "busy" || !pw}>{da ? "Download" : "Download"}</button></div>
      {st === "ok" && <p className="meta" role="status">{da ? "Downloadet." : "Downloaded."}</p>}
      {st === "wrong" && <p className="err" role="alert">{da ? "Forkert adgangskode." : "Wrong password."}</p>}
      {st === "limit" && <p className="err" role="alert">{da ? "Højst 3 gange i døgnet." : "At most 3 times a day."}</p>}
      {st === "err" && <p className="err" role="alert">{da ? "Kunne ikke hente data." : "Could not fetch data."}</p>}
    </form>);
}

function PrivacyPanel({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [p, setP] = useState<{ inactivity_delete: boolean; inactivity_days: number; cloud_sync: boolean; retention: string } | null>(null);
  const [pw, setPw] = useState(""); const [ok, setOk] = useState(false); const [state, setState] = useState<"" | "busy" | "wrong" | "err">("");
  useEffect(() => { supabase.rpc("get_my_privacy").then(({ data }) => setP(((data as any[]) ?? [])[0] ?? null)); }, []);
  const saveData = async (n: NonNullable<typeof p>) => { setP(n); await supabase.rpc("set_my_data_prefs", { p_cloud_sync: n.cloud_sync, p_retention: n.retention }); };
  const save = async (n: NonNullable<typeof p>) => { setP(n); await supabase.rpc("set_my_privacy", { p_inactivity_delete: n.inactivity_delete, p_inactivity_days: n.inactivity_days }); };
  const del = async (e: React.FormEvent) => {
    e.preventDefault(); setState("busy");
    let r; try { r = await callFn("delete-account", { password: pw }); } catch { r = { status: 0, data: null as any }; }
    if (r.status !== 200) { setState(r.status === 403 ? "wrong" : "err"); return; }
    try { localStorage.clear(); sessionStorage.clear(); if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
      const dbs = (indexedDB as any).databases ? await (indexedDB as any).databases() : []; for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name); } catch { /* best effort */ }
    await cacheClear(); await supabase.auth.signOut({ scope: "local" }); location.replace(location.pathname + "?deleted=1");
  };
  return (
    <div>
      <h3 id="data">{da ? "Opbevaring og synkronisering" : "Retention and sync"}</h3>
      {p && <>
        <label htmlFor="ret">{da ? "Behold mine beskeder i" : "Keep my messages for"}</label>
        <select id="ret" value={p.retention} onChange={(e) => saveData({ ...p, retention: e.target.value })}>
          <option value="1y">{da ? "1 år (standard)" : "1 year (default)"}</option><option value="5y">{da ? "5 år" : "5 years"}</option><option value="unlimited">{da ? "Ubegrænset" : "Unlimited"}</option></select>
        <p className="meta">{da ? "Ældre beskeder skjules for dig med det samme og slettes fra serveren, når alle i samtalen har passeret deres egen grænse. Vælger modparten længere tid, beholder de deres kopi." : "Older messages are hidden for you at once and deleted from the server when everyone in the conversation has passed their own limit. If the other person chose longer, they keep their copy."}</p>
        <label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={p.cloud_sync} onChange={(e) => saveData({ ...p, cloud_sync: e.target.checked })} />
          {da ? "Sky-synk (til flere enheder)" : "Cloud sync (for several devices)"}</label>
        <p className="meta">{da ? "Valgfrit, slået fra som standard. Gemmes nu. I web-testversionen ligger beskederne altid på serveren (EU, Frankfurt), da browseren ikke er en sikker fast kopi. I mobilappen betyder “fra”, at serveren kun holder beskeden til den er leveret." : "Optional, off by default. Saved now. In the web test version messages always stay on the server (EU, Frankfurt) as the browser is not a safe permanent copy. In the mobile app “off” means the server only keeps a message until it is delivered."}</p></>}
      <MyDataExport lang={lang} />
      <h3 id="inactivity">{da ? "Automatisk sletning ved inaktivitet" : "Automatic deletion when inactive"}</h3>
      {p && <>
        <label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={p.inactivity_delete} onChange={(e) => save({ ...p, inactivity_delete: e.target.checked })} />
          {da ? "Slet min konto, hvis jeg ikke logger ind i" : "Delete my account if I do not log in for"}</label>
        <select aria-label={da ? "Antal dage" : "Days"} disabled={!p.inactivity_delete} value={p.inactivity_days} onChange={(e) => save({ ...p, inactivity_days: +e.target.value })}>
          {[30, 60, 90].map((d) => <option key={d} value={d}>{d} {da ? "dage" : "days"}</option>)}</select>
        <p className="meta">{da ? "Du får en mail 14 dage før. Mailen indeholder ingen beskeder." : "You get an email 14 days before. It contains no messages."}</p></>}
      <h3 id="delete">{da ? "Slet min konto" : "Delete my account"}</h3>
      <p>{da ? "Sletter din konto, dine indstillinger, kaldenavne, farver og feedback på serveren samt alt, Rolff har gemt på denne enhed. Det kan ikke fortrydes." : "Deletes your account, settings, aliases, colours and feedback on the server, plus everything Rolff stored on this device. This cannot be undone."}</p>
      <p className="notice">{evidenceNote(lang)}</p>
      <form onSubmit={del}>
        <label htmlFor="delpw">{da ? "Bekræft med din adgangskode" : "Confirm with your password"}</label>
        <PasswordInput id="delpw" lang={lang} value={pw} onChange={(v) => { setPw(v); setState(""); }} minLength={1} autoComplete="current-password" />
        <label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={ok} onChange={(e) => setOk(e.target.checked)} />{da ? "Jeg forstår, at sletningen er endelig." : "I understand that deletion is final."}</label>
        <div className="row end"><button type="submit" className="danger" disabled={!ok || !pw || state === "busy"}>{da ? "Slet min konto permanent" : "Delete my account permanently"}</button></div>
        {state === "wrong" && <p className="err" role="alert">{da ? "Forkert adgangskode." : "Wrong password."}</p>}
        {state === "err" && <p className="err" role="alert">{da ? "Sletningen mislykkedes. Prøv igen." : "Deletion failed. Please try again."}</p>}
      </form>
    </div>
  );
}

export const emailVisibleNote = (lang: Lang) => lang === "da"
  ? "De andre i samtalen ser din e-mail som dit navn, indtil du vælger et kaldenavn (⋮ → Mit visningsnavn). Du logger altid ind med din e-mail."
  : "Others in the conversation see your e-mail as your name until you choose a nickname (⋮ → My display name). You always log in with your e-mail.";
function NameHint({ lang, open }: { lang: Lang; open: () => void }) {
  const da = lang === "da";
  const [show, setShow] = useState(false);
  useEffect(() => { if (localStorage.getItem("nameHintSeen")) return; supabase.rpc("get_my_public_name").then(({ data, error }) => { if (!error && !data) setShow(true); }); }, []);
  if (!show) return null;
  const done = () => { localStorage.setItem("nameHintSeen", "1"); setShow(false); };
  return <div className="notice" role="note">{emailVisibleNote(lang)} <div className="row end"><button className="ghost" onClick={done}>{da ? "OK" : "OK"}</button><button onClick={() => { done(); open(); }}>{da ? "Vælg kaldenavn" : "Choose nickname"}</button></div></div>;
}
function PublicName({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [v, setV] = useState(""); const [msg, setMsg] = useState("");
  useEffect(() => { supabase.rpc("get_my_public_name").then(({ data }) => setV((data as string) ?? "")); }, []);
  const save = async (name: string | null) => {
    const r = await supabase.rpc("set_my_public_name", { p_name: name });
    setMsg(r.error ? (da ? "Højst 40 tegn, uden @ og linjeskift." : "Max 40 characters, no @ or line breaks.") : (da ? "Gemt. Gælder straks i alle samtaler." : "Saved. Applies at once in all conversations."));
    if (!r.error && name === null) setV("");
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(v.trim() || null); }}>
      <p className="meta">{da ? "Det navn, de andre ser. Står feltet tomt, ser de din e-mail. Din e-mail er stadig dit login." : "The name others see. If empty, they see your e-mail. Your e-mail is still your login."}</p>
      <label htmlFor="pn">{da ? "Kaldenavn" : "Nickname"}</label>
      <input id="pn" maxLength={40} value={v} onChange={(e) => setV(e.target.value)} />
      <div className="row end"><button type="button" className="ghost" onClick={() => save(null)}>{da ? "Vis min e-mail" : "Show my e-mail"}</button><button type="submit">{da ? "Gem" : "Save"}</button></div>
      {msg && <p className="meta" role="status">{msg}</p>}
    </form>);
}
export const REPORT_CATS: [string, string, string][] = [["harassment", "Chikane/trusler", "Harassment/threats"], ["inappropriate", "Upassende indhold", "Inappropriate content"], ["child_safety", "Børns sikkerhed", "Child safety"], ["other", "Andet", "Other"]];
export const reportHonesty = (da: boolean) => da
  ? "Rapporten sendes som en e-mail til Rolffs udvikler. Der er ingen døgnvagt og ingen garanti for svar eller handling. Er nogen i akut fare, så ring 112 eller kontakt politiet (114)."
  : "The report is sent as an e-mail to Rolff's developer. There is no 24/7 staff and no guarantee of a reply or action. If someone is in immediate danger, call 112 or the police.";
function ReportForm({ lang, conv, msgs }: { lang: Lang; conv: string; msgs: Msg[] }) {
  const da = lang === "da";
  const [cat, setCat] = useState("harassment"); const [body, setBody] = useState(""); const [sel, setSel] = useState<string[]>([]);
  const [step, setStep] = useState<"edit" | "preview" | "busy" | "ok" | "err" | "limit">("edit");
  const chosen = msgs.filter((m) => sel.includes(m.id));
  const send = async () => {
    setStep("busy");
    let r; try { r = await callFn("report", { conversation_id: conv, category: cat, body: body.trim(), message_ids: sel }); } catch { r = { status: 0, data: null as any }; }
    setStep(r.status === 200 ? "ok" : r.status === 429 ? "limit" : "err");
  };
  if (step === "ok") return <p className="notice" role="status">{da ? "Rapporten er sendt. Tak." : "The report has been sent. Thank you."} {reportHonesty(da)}</p>;
  if (step !== "edit") return (
    <div>
      <p className="meta">{da ? "Forhåndsvisning – præcis dette sendes, og intet andet:" : "Preview – exactly this is sent, nothing else:"}</p>
      <p><strong>{REPORT_CATS.find((c) => c[0] === cat)![da ? 1 : 2]}</strong></p>
      <p style={{ whiteSpace: "pre-wrap" }}>{body.trim() || "–"}</p>
      <p className="meta">{da ? `Valgte beskeder (${chosen.length}):` : `Selected messages (${chosen.length}):`}</p>
      <ul className="words">{chosen.map((m) => <li key={m.id}><span>{m.sender_name}: {m.body}</span></li>)}</ul>
      <p className="meta">{da ? "Sammen med dit kaldenavn, bruger-id og samtale-id." : "Together with your nickname, user id and conversation id."}</p>
      <p className="notice" role="note">{reportHonesty(da)}</p>
      {step === "limit" && <p className="err" role="alert">{da ? "Du kan højst sende 3 rapporter pr. døgn." : "At most 3 reports per day."}</p>}
      {step === "err" && <p className="err" role="alert">{da ? "Kunne ikke sende. Prøv igen senere." : "Could not send. Try again later."}</p>}
      <div className="row end"><button className="ghost" onClick={() => setStep("edit")}>{da ? "Ret" : "Edit"}</button><button className="danger" disabled={step === "busy"} onClick={send}>{da ? "Bekræft og send rapport" : "Confirm and send report"}</button></div>
    </div>);
  return (
    <form onSubmit={(e) => { e.preventDefault(); setStep("preview"); }}>
      <p className="notice" role="note">{reportHonesty(da)}</p>
      <label htmlFor="rc">{da ? "Kategori" : "Category"}</label>
      <select id="rc" value={cat} onChange={(e) => setCat(e.target.value)}>{REPORT_CATS.map(([k, d, en]) => <option key={k} value={k}>{da ? d : en}</option>)}</select>
      <label htmlFor="rb">{da ? "Beskriv hvad der er sket" : "Describe what happened"}</label>
      <textarea id="rb" maxLength={2000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      <p className="meta">{da ? "Vedhæft beskeder (valgfrit, højst 20). Kun dem, du markerer, sendes." : "Attach messages (optional, max 20). Only those you tick are sent."}</p>
      <div style={{ maxHeight: 220, overflow: "auto" }}>{msgs.slice(-50).map((m) => <label key={m.id} style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={sel.includes(m.id)} disabled={!sel.includes(m.id) && sel.length >= 20} onChange={(e) => setSel(e.target.checked ? [...sel, m.id] : sel.filter((x) => x !== m.id))} /><span>{m.sender_name}: {m.body.slice(0, 80)}</span></label>)}</div>
      <div className="row end"><button type="submit" disabled={!body.trim() && sel.length === 0}>{da ? "Se forhåndsvisning" : "Preview"}</button></div>
    </form>);
}

function FeedbackForm({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [cat, setCat] = useState("suggestion"); const [body, setBody] = useState(""); const [state, setState] = useState<"" | "busy" | "ok" | "err" | "limit">("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setState("busy");
    let r; try { r = await callFn("feedback", { category: cat, body: body.trim() }); } catch { r = { status: 0, data: null as any }; }
    if (r.status === 200) { setState("ok"); setBody(""); } else setState(r.status === 429 ? "limit" : "err");
  };
  return (
    <form onSubmit={submit}>
      <p className="meta">{da ? "Skriv ikke samtaleindhold eller personoplysninger, du ikke vil dele. Feedback sendes til Rolff sammen med dit kaldenavn og bruger-id – ikke dine samtaler." : "Do not write conversation content or personal data you do not want to share. Feedback is sent to Rolff with your nickname and user id – not your conversations."}</p>
      <label htmlFor="fc">{da ? "Kategori" : "Category"}</label>
      <select id="fc" value={cat} onChange={(e) => setCat(e.target.value)}><option value="suggestion">{da ? "Forslag" : "Suggestion"}</option><option value="complaint">{da ? "Klage" : "Complaint"}</option><option value="filter">{da ? "Filter-feedback" : "Filter feedback"}</option></select>
      <label htmlFor="fb">{da ? "Din feedback" : "Your feedback"}</label>
      <textarea id="fb" rows={5} maxLength={2000} required value={body} onChange={(e) => { setBody(e.target.value); setState(""); }} />
      <div className="row end"><button type="submit" disabled={state === "busy" || !body.trim()}>{da ? "Send feedback" : "Send feedback"}</button></div>
      {state === "ok" && <p className="meta" role="status">{da ? "Tak! Din feedback er sendt." : "Thanks! Your feedback was sent."}</p>}
      {state === "limit" && <p className="err" role="alert">{da ? "Du har sendt meget feedback i dag. Prøv igen i morgen." : "Too much feedback today. Try again tomorrow."}</p>}
      {state === "err" && <p className="err" role="alert">{da ? "Feedback kunne ikke gemmes." : "Could not save feedback."}</p>}
    </form>
  );
}

function Auth({ lang, peek }: { lang: Lang; peek?: Peek | null }) {
  const t = strings[lang];
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login"); const [sent, setSent] = useState(false);
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  useEffect(() => { if (peek) { setMode("signup"); setEmail(peek.invitee_email); } }, [peek]); const [ai, setAi] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (mode === "forgot") { setBusy(true); try { await callFn("account-mail", { action: "recover", email }); } catch { /* same message */ } setBusy(false); setSent(true); return; }
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
      {peek ? <div className="notice"><strong>{lang === "da" ? `${peek.inviter_email} har inviteret dig.` : `${peek.inviter_email} invited you.`}</strong> {lang === "da" ? "Vælg en adgangskode for at komme ind i samtalen. Har du allerede en konto, så log ind." : "Choose a password to join. Already have an account? Log in."}<p className="meta" style={{ marginBottom: 0 }}>{evidenceNote(lang)} {emailVisibleNote(lang)}</p></div>
        : peek === null ? <div className="notice" role="alert">{lang === "da" ? "Invitationen er ugyldig, udløbet eller allerede brugt." : "The invitation is invalid, expired or already used."}</div> : null}
      {new URLSearchParams(location.search).has("deleted") && <div className="notice" role="status">{lang === "da" ? "Din konto er slettet." : "Your account has been deleted."}</div>}
      <div className="notice" role="note"><strong>{t.demoWarn}</strong></div>
      <p>{t.tagline}</p><p>{t.intro}</p>
      {mode === "forgot" ? <form onSubmit={submit}>
        <h2>{lang === "da" ? "Glemt adgangskode" : "Forgot password"}</h2>
        {sent ? <p className="notice" role="status">{lang === "da" ? "Hvis der findes en konto med den e-mail, har vi sendt et link til at vælge en ny adgangskode. Tjek også spam." : "If an account exists for that email, we have sent a link to choose a new password. Check spam too."}</p>
          : <><label htmlFor="fe">{t.email}</label><input id="fe" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></>}
        <div className="row" style={{ marginTop: 12 }}>
          {!sent && <button type="submit" disabled={busy}>{lang === "da" ? "Send link" : "Send link"}</button>}
          <button type="button" className="ghost" onClick={() => { setMode("login"); setSent(false); }}>{t.login}</button>
        </div>
      </form> : <form onSubmit={submit}>
        <label htmlFor="e">{t.email}</label><input id="e" type="email" required autoComplete="email" readOnly={!!peek} value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="p">{t.password}</label>
        <PasswordInput id="p" lang={lang} value={pw} onChange={setPw} minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {mode === "signup" && <><label htmlFor="p2">{pwText[lang].repeat}</label>
          <PasswordInput id="p2" lang={lang} value={pw2} onChange={(v) => { setPw2(v); setErr(""); }} minLength={8} autoComplete="new-password" invalid={pw2.length > 0 && !passwordsMatch(pw, pw2)} describedBy="pwerr" /></>}
        {mode === "signup" && <p className="meta" role="note">{evidenceNote(lang)} {emailVisibleNote(lang)}</p>}
        {mode === "signup" && <p><label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} required />{t.demoAccept}</label></p>}
        {mode === "signup" && <p><label style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={ai} onChange={(e) => setAi(e.target.checked)} required />{t.ai} {t.aiAccept}</label></p>}
        {err ? <p className="err" id="pwerr" role="alert">{err}</p>
          : mode === "signup" && pw2.length > 0 && !passwordsMatch(pw, pw2) ? <p className="err" id="pwerr" aria-live="polite">{pwText[lang].mismatch}</p> : null}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy}>{mode === "login" ? t.login : t.signup}</button>
          <button type="button" className="ghost" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setPw2(""); setErr(""); }}>{mode === "login" ? t.signup : t.login}</button>
        </div>
        {mode === "login" && !peek && <p><button type="button" className="linkish" onClick={() => { setMode("forgot"); setErr(""); }}>{lang === "da" ? "Glemt adgangskode?" : "Forgot password?"}</button></p>}
      </form>}
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

function ColorDot({ lang, conv, label, initial, changed }: { lang: Lang; conv: Conv; label: string; initial?: string; changed: (c: string) => void }) {
  const da = lang === "da"; const [open, setOpen] = useState(false); const color = conv.color || "teal";
  useBackLayer(open,()=>setOpen(false));
  const letter = (initial || label.trim().match(/[\p{L}\p{N}]/u)?.[0] || "?").toUpperCase();
  const pick = async (c: string) => { const { error } = await supabase.rpc("set_conversation_color", { conv: conv.id, p_color: c }); if (!error) { changed(c); setOpen(false); } };
  return (
    <span className="dotwrap">
      <button type="button" className={`dot c-${color}`} aria-label={da ? `Vælg farve for samtalen med ${label}` : `Choose colour for conversation with ${label}`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <span aria-hidden="true">{letter}</span>
      </button>
      {open && <span className="palette" role="group" aria-label={da ? "Farver (kun synlige for dig)" : "Colours (only visible to you)"}>
        {COLORS.map((c) => <button key={c} type="button" className={`swatch c-${c}`} aria-label={COLOR_NAMES[c][da ? 0 : 1]} aria-pressed={c === color} onClick={(e) => { e.stopPropagation(); pick(c); }}>{c === color ? "✓" : ""}</button>)}
      </span>}
    </span>
  );
}

function Home({ lang, open, invite, rename, refreshKey }: { lang: Lang; open: (c: Conv) => void; invite: () => void; rename: (contacts: Other[]) => void; refreshKey: number }) {
  const t = strings[lang]; const da = lang === "da";
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const load = useCallback(async () => { const { data } = await supabase.rpc("list_my_conversations"); setConvs((data as Conv[]) ?? []); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  return (
    <div className="card list"><h2>{t.conversations}</h2>
      {convs?.length === 0 && <p className="meta">{da ? "Ingen samtaler endnu. " : "No conversations yet. "}<button type="button" className="linkbtn" onClick={invite}>{da ? "Inviter en person" : "Invite someone"}</button></p>}
      {(convs ?? []).map((c) => { const d = convDisplay(c, da); return (
        <div key={c.id} className="convrow">
          <ColorDot lang={lang} conv={c} label={d.title} initial={d.initial} changed={(col) => setConvs((convs ?? []).map((x) => x.id === c.id ? { ...x, color: col } : x))} />
          <ContactButton open={() => open(c)} rename={() => rename(c.others)}>
            <span className="convname">{d.title}</span>
            {d.status && <span className="meta convstatus">{d.status}</span>}
          </ContactButton>
          {!!c.others.length && <button type="button" className="ghost pencil" aria-label={da ? `Privat kaldenavn for ${d.title}` : `Private nickname for ${d.title}`} onClick={() => rename(c.others)}>✎</button>}
        </div>); })}
    </div>
  );
}

function InviteByEmail({ lang, done }: { lang: Lang; done: () => void }) {
  const da = lang === "da";
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string; plan?: boolean } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    let r; try { r = await callFn("invite-email", { email }); } catch { r = { status: 0, data: null as any }; }
    setBusy(false);
    if (r.status === 200) { setMsg({ ok: true, text: da ? `Invitationen er sendt til ${email}. Du får en kopi på mail.` : `Invitation sent to ${email}. You will get a copy by email.` }); setEmail(""); done(); }
    else setMsg({ ok: false, text: r.data?.error === "rate_limited" ? (da ? "Du har sendt mange invitationer i dag. Prøv igen i morgen." : "Too many invitations today.")
      : r.data?.error === "bad_input" ? (da ? "Tjek e-mailadressen." : "Check the email address.") : (da ? "Mailen kunne ikke sendes. Prøv igen senere." : "The email could not be sent. Try again later.") });
  };
  return (
    <form onSubmit={submit}><p className="meta" role="note">{evidenceNote(lang)} {emailVisibleNote(lang)}</p>
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


type Pending = { id: string; role: string; invitee_email: string | null; consents: number; required: number; i_consented: boolean; mine: boolean };

function markAll(text: string, q: string, current: boolean): (string | React.ReactElement)[] | string {
  const n = q.trim(); if (!n) return text;
  const lo = text.toLocaleLowerCase(), nl = n.toLocaleLowerCase(); const out: (string | React.ReactElement)[] = []; let i = 0, k = 0;
  for (let j = lo.indexOf(nl); j >= 0; j = lo.indexOf(nl, i)) { out.push(text.slice(i, j), <mark key={k++} className={current ? "cur" : ""}>{text.slice(j, j + n.length)}</mark>); i = j + n.length; }
  out.push(text.slice(i)); return out;
}

const Icon = ({ d }: { d: React.ReactNode }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{d}</svg>;

function Chat({ session, lang, conv, back, menu, openPlans, planKey, rename }: { session: Session; lang: Lang; conv: Conv; back: () => void; menu: MenuItem[]; openPlans: () => void; planKey: Sheet; rename: (contacts: Other[]) => void }) {
  const [plan, setPlan] = useState<string | null>(null);
  const loadPlan = useCallback(() => { supabase.rpc("get_my_plan").then(({ data }) => { if (data?.[0]) setPlan(data[0].plan); }); }, []);
  useEffect(() => { loadPlan(); }, [planKey, loadPlan]);
  const [others, setOthers] = useState<Other[]>(conv.others ?? []); const [color, setColor] = useState<string | null>(conv.color);
  useEffect(() => { setOthers(conv.others ?? []); }, [conv.others]);
  const t = strings[lang]; const da = lang === "da";
  const draftKey = `draft:${conv.id}`; const replyKey = `draft-reply:${conv.id}`;
  const [msgs, setMsgs] = useState<Msg[]>([]); const [pending, setPending] = useState(0);
  const events = useConversationEvents(conv.id, msgs.length);
  type ReplyTarget = { id: string; body: string | null; mine: boolean; sender_id: string | null; sender_name: string | null; sender_email?: string | null };
  const [reply, setReply] = useState<ReplyTarget | null>(() => { const id = localStorage.getItem(replyKey); return id && /^[0-9a-f-]{36}$/i.test(id) ? { id, body: null, mine: false, sender_id: null, sender_name: null } : null; });
  const composerRef = useRef<HTMLTextAreaElement>(null); const composerRootRef = useRef<HTMLDivElement>(null);
  const [replyFocus, setReplyFocus] = useState(0);
  const [invs, setInvs] = useState<Pending[]>([]);
  const [text, setText] = useState(localStorage.getItem(draftKey) ?? "");
  const [status, setStatus] = useState<{ kind: string; spans?: string[]; blockedText?: string; suggestion?: string; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false); const [attachmentBusy, setAttachmentBusy] = useState(false); const sending = busy || attachmentBusy;
  // Soft one-shot glow on the just-approved own bubble (not history / initial load).
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armFlash = useCallback((id: string | null | undefined) => {
    if (!id || typeof id !== "string") return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashId(id);
    flashTimer.current = setTimeout(() => { setFlashId(null); flashTimer.current = null; }, 850);
  }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const [lim, setLim] = useState<SendLimits | null>(null);
  const cap = effectiveCharLimit(plan);
  const [file, setFile] = useState<File | null>(null);
  const retryKey = !file ? textRetryKey(localStorage.getItem(`idem:${conv.id}`), text, reply?.id ?? null) : null;
  const attachmentSend = useRef<(() => void) | null>(null);
  const loadLim = useCallback(async () => { const { data } = await supabase.rpc("get_my_send_limits", { conv: conv.id }); setLim((data as SendLimits[])?.[0] ?? null); }, [conv.id]);
  useEffect(() => { loadLim(); }, [loadLim, msgs.length]);
  const [, tick] = useState(0); useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(i); }, []);
  const who = (id?: string | null) => { const o = (others ?? []).find((x) => x.user_id === id); return o ? labelOf(o) : (da ? "Modtageren" : "The recipient"); };
  const limitMsg = (d: any): string | null => {
    if (d?.status === "plan_length_limit") { loadPlan(); return da ? `Beskeden blev ikke sendt: Din plan tillader højst ${d.limit} tegn; din besked er ${d.count} tegn.` : `Not sent: your plan allows up to ${d.limit} characters; yours is ${d.count}.`; }
    if (d?.status === "frequency_limit") return da ? `Beskeden blev ikke sendt: ${who(d.by)} har sat en frekvensgrænse; du kan sende igen ${waitText(d.retry_after_s, true)}.` : `Not sent: ${who(d.by)} has set a frequency limit; you can send again ${waitText(d.retry_after_s, false)}.`;
    return null;
  };
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { supabase.from("conversation_blocks").select("user_id").eq("conversation_id", conv.id).then(({ data }) => setBlocked((data ?? []).length > 0)); }, [conv.id]);
  const setBlock = async (on: boolean) => { const r = await supabase.rpc(on ? "block_conversation" : "unblock_conversation", { conv: conv.id }); if (!r.error) setBlocked(on); };
  const [sheet, setSheet, resetSheet] = usePanelState<Sheet>(null);
  const addPersonRef = useRef<HTMLButtonElement>(null);
  const [q, setQ] = useState<string | null>(null); const [cur, setCur] = useState(0);
  useBackLayer(q!==null,()=>setQ(null));
  const endRef = useRef<HTMLDivElement>(null); const listRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const uid = (await supabase.auth.getSession()).data.session?.user.id;
    if (uid) await syncReceiveTimezone(uid);
    const { data, error } = await supabase.rpc("get_messages_v2", { conv: conv.id });
    if (data) { setMsgs(data as Msg[]); setReply(r => { if (!r) return null; const m = (data as Msg[]).find(x => x.id === r.id); return m ? { id: m.id, body: m.body ?? null, mine: m.mine, sender_id: m.sender_id, sender_name: m.sender_name, sender_email: m.sender_email } : { ...r, body: null }; }); if (uid) cacheSet(uid, conv.id, data); }
    else if (error && uid) { const c = await cacheGet<Msg[]>(uid, conv.id); if (c) setMsgs(c); }
    const p = await supabase.rpc("my_pending_count"); setPending((p.data as number) ?? 0);
    const i = await supabase.rpc("list_pending_invitations", { conv: conv.id }); setInvs((i.data as Pending[]) ?? []);
  }, [conv.id]);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);
  // The chat is a fixed-height column: only the message list scrolls, so the
  // composer stays pinned at the bottom. Never use scrollIntoView here — it also
  // scrolls the page and pushed the composer off-screen after approval.
  const atBottom = useRef(true);
  const toBottom = useCallback(() => { const l = listRef.current; if (l) { l.scrollTop = l.scrollHeight; atBottom.current = true; } }, []);
  useLayoutEffect(() => { if (q === null) toBottom(); }, [msgs.length, toBottom]);
  useEffect(() => {
    const l = listRef.current; if (!l) return;
    const onScroll = () => { atBottom.current = l.scrollHeight - l.scrollTop - l.clientHeight < 24; };
    // Notices, Luna, the reply bar or the keyboard can shrink the list; keep the newest message in view.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (atBottom.current) l.scrollTop = l.scrollHeight; });
    l.addEventListener("scroll", onScroll, { passive: true }); ro?.observe(l);
    return () => { l.removeEventListener("scroll", onScroll); ro?.disconnect(); };
  }, []);
  // Track the visible viewport (mobile keyboard) so the column fits above it.
  useEffect(() => {
    const v = window.visualViewport, root = document.documentElement;
    let full = window.innerHeight, width = window.innerWidth;
    const fit = () => { if (window.innerWidth !== width) { width = window.innerWidth; full = window.innerHeight; } full = Math.max(full, window.innerHeight); const h = Math.round(v ? v.height : window.innerHeight); root.style.setProperty("--app-h", `${h}px`); if (h < full * 0.75) root.dataset.kbd = ""; else delete root.dataset.kbd; if (window.scrollY && !v?.offsetTop) window.scrollTo(0, 0); };
    fit(); v?.addEventListener("resize", fit); window.addEventListener("resize", fit);
    return () => { v?.removeEventListener("resize", fit); window.removeEventListener("resize", fit); root.style.removeProperty("--app-h"); delete root.dataset.kbd; };
  }, []);
  // Every Besvar must bring the composer into view and focus it — even when
  // the same message is already selected, the keyboard is open, or focus was kept.
  useLayoutEffect(() => {
    if (!replyFocus) return;
    let cancelled = false;
    const bring = () => {
      if (cancelled) return;
      toBottom();
      composerRootRef.current?.scrollIntoView({ block: "nearest" });
      const input = composerRef.current;
      if (!input) return;
      if (document.activeElement === input) input.blur();
      input.focus({ preventScroll: false });
      input.scrollIntoView({ block: "nearest" });
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(bring));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [replyFocus, toBottom]);
  useEffect(() => { localStorage.setItem(draftKey, text); }, [text, draftKey]);
  useEffect(() => { if (reply) localStorage.setItem(replyKey, reply.id); else localStorage.removeItem(replyKey); }, [reply?.id, replyKey]);
  const hits = q ? findHits(msgs.map((m) => m.body), q) : [];
  const curIdx = hits.length ? hits[Math.min(cur, hits.length - 1)] : -1;
  useEffect(() => { if (curIdx >= 0) listRef.current?.querySelector(`[data-i="${curIdx}"]`)?.scrollIntoView({ block: "center" }); }, [curIdx, q]);
  const send = async () => {
    if (sending || !plan || !text.trim() || (count(text) > cap && !retryKey)) return;
    setBusy(true); setStatus(null);
    const keyStore = `idem:${conv.id}`;
    const saved = { text, reply: reply?.id ?? null, key: retryKey ?? crypto.randomUUID() };
    localStorage.setItem(keyStore, JSON.stringify(saved));
    let r; try { r = await callFn("send-message", { conversation_id: conv.id, body: text, reply_to_id: reply?.id ?? null, idempotency_key: saved.key }); } catch { r = { status: 0, data: null }; }
    setBusy(false);
    if (r.status === 200 && r.data?.status === "accepted") { setText(""); setReply(null); localStorage.removeItem(draftKey); localStorage.removeItem(replyKey); localStorage.removeItem(keyStore); setStatus({ kind: "accepted" }); armFlash(r.data?.message_id); load(); }
    else if (r.status === 200 && r.data?.status === "clarification_required") setStatus({ kind: "clarification" });
    else if (r.status === 200 && r.data?.status === "blocked") setStatus({ kind: "blocked", spans: r.data.spans ?? [], blockedText: text, suggestion: typeof r.data.suggestion === "string" ? r.data.suggestion : "", reason: r.data.reason_code });
    else if (r.status === 200 && r.data?.status === "private_boundary") setStatus({ kind: "note", blockedText: da ? "Beskeden kan ikke sendes på grund af en privat modtagerindstilling. Ret beskeden og prøv igen." : "Not sent due to a private recipient setting. Edit your message and retry." });
    else if (r.status === 200 && r.data?.status === "blocked_word") setStatus({ kind: "note", blockedText: da ? `Beskeden blev ikke sendt: Modtageren har blokeret ordet/sætningen "${r.data.word}". Ret beskeden og prøv igen.` : `The message was not sent: the recipient has blocked the word/phrase "${r.data.word}". Edit the message and try again.` });
    else if (r.status === 200 && r.data?.status === "rule") setStatus({ kind: "note", blockedText: ({ emoji: da ? "Beskeden blev ikke sendt: Emojis er ikke tilladt i Rolff. Skriv det med ord." : "Not sent: emojis are not allowed in Rolff. Use words.", caps: da ? "Beskeden blev ikke sendt: Den er skrevet med store bogstaver, som kan opfattes som råb." : "Not sent: all caps can read as shouting.", repeat: da ? "Beskeden blev ikke sendt: Du har lige sendt den samme besked." : "Not sent: you just sent the same message." } as Record<string, string>)[r.data.rule] ?? "" });
    else if (r.status === 200 && limitMsg(r.data)) { setStatus({ kind: "note", blockedText: limitMsg(r.data)! }); loadLim(); }
    else if (r.status === 200 && r.data?.status === "cannot_deliver") setStatus({ kind: "note", blockedText: da ? "Beskeden kan ikke sendes i denne samtale." : "Messages cannot be sent in this conversation." });
    else if (r.data?.error === "invalid_reply") setStatus({ kind: "note", blockedText: da ? "Den valgte besked kan ikke besvares. Fjern svarvalget, og prøv igen." : "The selected message cannot be replied to. Remove the reply and try again." });
    else if (r.data?.error === "read_only") setStatus({ kind: "readOnly" });
    else if (r.status === 429) setStatus({ kind: "rateLimited" });
    else setStatus({ kind: "techError" });
  };
  const receiveNow = async () => { await callFn("receive-now", {}); load(); };
  const answer = async (id: string, action: "consent" | "decline") => { await callFn("invite-email", { action, invitation_id: id }); load(); };
  const d = convDisplay({ others, pending_invitee: conv.pending_invitee }, da); const label = d.title;
  const roleTxt = (r: string) => r === "reader" ? (da ? "kun læse" : "read only") : (da ? "læse og skrive" : "read and write");
  const replyWho = (m: Pick<ReplyTarget, "mine" | "sender_id" | "sender_name" | "sender_email">) => {
    if (m.mine) return da ? "dig selv" : "yourself";
    const o = (others ?? []).find((x) => x.user_id === m.sender_id);
    if (o) return labelOf(o);
    return m.sender_name || m.sender_email || (da ? "Modtageren" : "The recipient");
  };
  const sameSender = (a: Msg, b: Msg) => a.mine === b.mine && ((a.sender_id && b.sender_id) ? a.sender_id === b.sender_id : true);
  const beginReply = (selected: Message) => {
    if (sending) return;
    setReply({ id: selected.id, body: selected.body ?? null, mine: selected.mine, sender_id: selected.sender_id, sender_name: selected.sender_name, sender_email: selected.sender_email });
    setReplyFocus((n) => n + 1);
  };
  return (
    <>
      <header className="topbar chat">
        <button className="icon" onClick={back} aria-label={t.back}><Icon d={<path d="M15 18l-6-6 6-6" />} /></button>
        <ColorDot lang={lang} conv={{ ...conv, color }} label={label} initial={d.initial} changed={setColor} />
        <div role="heading" aria-level={2} className="chattitle">{others.length ? others.map((o) => <button key={o.user_id} type="button" className="contact-heading" title={da ? "Privat kaldenavn" : "Private nickname"} onClick={() => rename([o])}>{labelOf(o)}</button>) : <><span className="convname">{d.title}</span>{d.status && <span className="meta convstatus"> · {d.status}</span>}</>}</div>
        <button className="icon" aria-label={da ? "Søg i samtalen" : "Search conversation"} aria-pressed={q !== null} onClick={() => { setQ(q === null ? "" : null); setCur(0); }}><Icon d={<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>} /></button>
        {conv.role === "parent" && <button ref={addPersonRef} className="icon" aria-label={da ? "Tilføj person" : "Add person"} aria-haspopup="dialog" aria-expanded={sheet === "addMember"} onClick={() => setSheet("addMember")}><Icon d={<><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6" /><path d="M19 8v6M16 11h6" /></>} /></button>}
        <Menu lang={lang} items={[{ label: da ? "Deltagere og roller" : "Participants and roles", run: () => setSheet("members") },
          { label: da ? "Eksportér samtale" : "Export conversation", run: () => setSheet("export") },
          { label: da ? "Blokeringer" : "Blocking lists", run: () => setSheet("words") },
          { label: da ? "Rapportér" : "Report", run: () => setSheet("report") },
          blocked ? { label: da ? "Afblokér samtale" : "Unblock conversation", run: () => setBlock(false) } : { label: da ? "Blokér samtale" : "Block conversation", run: () => { if (confirm(da ? "Blokér samtalen? De andre kan ikke sende dig beskeder her, før du selv afblokerer. De får ikke at vide, at du har blokeret." : "Block this conversation? The others cannot send messages here until you unblock. They are not told that you blocked.")) setBlock(true); }, danger: true }, ...menu]} />
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
        <div className="meta">{iv.consents >= iv.required ? (da ? "Alle har godkendt. Invitationen er sendt og venter på, at personen tager imod." : "Everyone approved. The invitation was sent and awaits acceptance.")
          : da ? `Afventer godkendelse: ${iv.consents} af ${iv.required} har godkendt. Ét afslag stopper invitationen.` : `Awaiting approval: ${iv.consents} of ${iv.required} approved. One rejection stops it.`}</div>
        {!iv.i_consented ? <div className="row end"><button className="ghost" onClick={() => answer(iv.id, "decline")}>{da ? "Afvis" : "Reject"}</button><button onClick={() => answer(iv.id, "consent")}>{da ? "Godkend" : "Approve"}</button></div>
          : iv.mine ? <div className="row end"><button className="ghost" onClick={() => answer(iv.id, "decline")}>{da ? "Træk tilbage" : "Withdraw"}</button></div> : null}
      </div>)}
      {pending > 0 && <div className="notice row"><span>{t.pending(pending)}</span><span className="spacer" /><button onClick={receiveNow}>{t.receiveNow}</button></div>}
      <div className="msgs" aria-live="polite" ref={listRef}>
        {msgs.length === 0 && <p className="meta">{t.empty}</p>}
        {msgs.map((m, i) => <Fragment key={m.id}>{eventsBefore(events, msgs, i).map((e) => <EventNotice key={e.id} e={e} lang={lang} />)}<MessageBubble m={m} lang={lang} index={i} hit={i === curIdx} tailed={i === 0 || !sameSender(msgs[i - 1], m)} flash={m.mine && m.id === flashId} canReply={conv.role !== "reader" && !sending} onReply={beginReply}>{q ? markAll(m.body, q, i === curIdx) : m.body}{m.att_mime && <AttachmentView lang={lang} m={m} />}</MessageBubble></Fragment>)}
        {eventsBefore(events, msgs, msgs.length).map((e) => <EventNotice key={e.id} e={e} lang={lang} />)}
        <div ref={endRef} />
      </div>
      {status?.kind === "blocked" && <div className="notice" role="alert"><p style={{ margin: 0 }}>{t.blocked}</p>{status.spans!.length > 0 && <p className="meta" style={{ marginBottom: 0 }}>{t.flagged}: {highlight(status.blockedText!, status.spans!)}</p>}{status.suggestion ? <div className="suggest"><p className="meta" style={{ margin: "8px 0 4px" }}><strong>{t.suggestionLabel}</strong></p><p style={{ margin: "0 0 8px" }}>{status.suggestion}</p><button type="button" className="ghost" onClick={() => { setText(applySuggestion(text, status.suggestion)); setStatus(null); }}>{t.useSuggestion}</button><p className="meta" style={{ margin: "6px 0 0" }}>{da ? "Forslaget kopieres til skrivefeltet. Du kan rette det og skal selv trykke Send — det tjekkes igen. Originalteksten står stadig i feltet, indtil du vælger forslaget." : "The suggestion is copied into the composer. You can edit it and must press Send yourself — it is checked again. Your original text stays until you use the suggestion."}</p></div> : <div className="suggest"><p className="meta" style={{ margin: "8px 0 4px" }}><strong>{t.guidanceLabel}</strong></p><p className="meta" style={{ margin: 0 }}>{t.blockGuidance}</p></div>}</div>}
      {status?.kind === "clarification" && <div className="notice" role="alert">{da ? "Beskeden er ikke sendt. Vi er usikre på, hvad du mener. Vil du skrive det lidt tydeligere?" : "Your message was not sent. We’re not sure what you mean. Could you write it a little more clearly?"}</div>}
      {status?.kind === "note" && <div className="notice" role="alert">{status.blockedText}</div>}
      {status && status.kind !== "blocked" && status.kind !== "note" && status.kind !== "clarification" && <div className={status.kind === "accepted" ? "notice" : "err"} role="status">{(t as any)[status.kind]}</div>}
      {conv.role !== "reader" ? (
        <div className="card composer" ref={composerRootRef}><fieldset className="composer-fields" disabled={sending}>
          <ComposerInput lang={lang} text={text} onText={setText} textareaRef={composerRef} plan={plan} cap={cap} busy={sending} file={file} onFile={setFile} openPlans={openPlans} retry={!!retryKey} canSend={!!file || !!text.trim()} onSend={() => { if (file) attachmentSend.current?.(); else send(); }} leading={reply ? <ReplyComposer who={replyWho(reply)} body={reply.body} unavailable={reply.body == null} lang={lang} onCancel={() => { setReply(null); composerRef.current?.focus(); }} /> : null} statusSlot={<LunaIndicator checking={sending} accepted={status?.kind === "accepted"} label={t.sending} pendingText={sending ? (file ? (text.trim() || file.name) : text) : undefined} />} />
          <AttachBar lang={lang} conv={conv.id} plan={plan} openPlans={openPlans} caption={text} file={file} setFile={setFile} sendRef={attachmentSend} cap={cap} replyTo={reply?.id ?? null} onBusy={setAttachmentBusy} limitMsg={limitMsg} sent={(messageId) => { setText(""); setReply(null); localStorage.removeItem(draftKey); localStorage.removeItem(replyKey); setStatus({ kind: "accepted" }); armFlash(messageId); load(); loadLim(); }} />
          {(() => { const wait = lim?.next_at ? Math.ceil((new Date(lim.next_at).getTime() - Date.now()) / 1000) : 0; return wait > 0 ? <p className="meta" role="status">{da ? `Du kan sende igen ${waitText(wait, true)}.` : `You can send again ${waitText(wait, false)}.`}</p> : null; })()}
        </fieldset></div>) : <div className="notice" role="note">{t.readOnly}</div>}
      {blocked && <div className="notice" role="status">{da ? "Du har blokeret samtalen. De andre kan ikke sende beskeder her. " : "You blocked this conversation. The others cannot send messages here. "}<button className="ghost" onClick={() => setBlock(false)}>{da ? "Afblokér" : "Unblock"}</button></div>}
      {sheet === "report" && <SheetView title={da ? "Rapportér" : "Report"} close={() => setSheet(null)} lang={lang}><ReportForm lang={lang} conv={conv.id} msgs={msgs} /></SheetView>}
      {sheet === "words" && <SheetView title={da ? "Blokeringer" : "Blocking lists"} close={() => setSheet(null)} lang={lang}><BlockingLists key={`${session.user.id}:${conv.id}`} session={session} lang={lang} conv={conv.id} /></SheetView>}
      {sheet === "members" && <SheetView title={da ? "Deltagere og roller" : "Participants and roles"} close={() => setSheet(null)} lang={lang}><Members lang={lang} conv={conv.id} isParent={conv.role === "parent"} left={back} openWords={() => setSheet("words")} /></SheetView>}
      {sheet === "export" && <SheetView title={da ? "Udskrift af samtale" : "Conversation transcript"} close={() => setSheet(null)} lang={lang}><ConversationExport lang={lang} conv={conv.id} plan={plan} ownEmail={session.user.email ?? ""} openPlans={() => { setSheet(null); openPlans(); }} /></SheetView>}
      {sheet === "addMember" && <SheetView title={da ? "Tilføj person" : "Add person"} close={() => setSheet(null)} lang={lang} anchor={addPersonRef}><AddMember lang={lang} conv={conv.id} done={load} openPlans={openPlans} /></SheetView>}
      <Toast />
    </>
  );
}

type Member = { user_id: string; label: string; role: string; me: boolean };
export const roleName = (r: string, da: boolean) => r === "parent" ? (da ? "Part" : "Party") : r === "writer" ? (da ? "Læse og skrive" : "Read and write") : (da ? "Kun læse" : "Read only");
function Members({ lang, conv, isParent, left, openWords }: { lang: Lang; conv: string; isParent: boolean; left: () => void; openWords: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const da = lang === "da";
  const [ms, setMs] = useState<Member[] | null>(null); const [err, setErr] = useState("");
  const load = useCallback(async () => { const { data, error } = await supabase.rpc("list_conversation_members", { conv }); if (error) setErr(da ? "Kunne ikke hente deltagere." : "Could not load participants."); else setMs((data as Member[]) ?? []); }, [conv, da]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: string, args: Record<string, unknown>, q: string) => {
    if (!confirm(q)) return; setErr("");
    const { error } = await supabase.rpc(fn, { conv, ...args });
    if (error) { setErr(da ? "Handlingen mislykkedes." : "The action failed."); return; }
    if (fn === "leave_conversation") left(); else load();
  };
  if (!ms) return <p className="meta" role="status">{err || (da ? "Henter…" : "Loading…")}</p>;
  const me = ms.find((m) => m.me);
  return (
    <div>
      <ul className="words">{ms.map((m) => <li key={m.user_id}>
        <span>{m.me ? (da ? "Dig" : "You") : m.label} · <strong>{roleName(m.role, da)}</strong></span>
        {isParent && !m.me && m.role !== "parent" && <span className="row">
          {m.role === "writer" && <button type="button" className="ghost" onClick={() => act("set_member_role", { p_user: m.user_id, p_role: "reader" }, da ? `Gør ${m.label} til "Kun læse"?` : `Make ${m.label} read only?`)}>{da ? "Gør til kun læse" : "Make read only"}</button>}
          <button type="button" className="ghost danger" onClick={() => act("remove_member", { p_user: m.user_id }, da ? `Fjern ${m.label} fra samtalen? Personen kan ikke længere se nye eller gamle beskeder her.` : `Remove ${m.label}? They can no longer see messages here.`)}>{da ? "Fjern" : "Remove"}</button>
        </span>}
        {!m.me && <button type="button" className="ghost" aria-expanded={open === m.user_id} onClick={() => setOpen(open === m.user_id ? null : m.user_id)}>{da ? "Indstillinger for denne person" : "Settings for this person"}</button>}
        {open === m.user_id && <PersonSettings lang={lang} sender={m.user_id} label={m.label} openWords={openWords} />}
      </li>)}</ul>
      <p className="meta">{da ? "Parterne kan fjerne ekstra deltagere eller gøre en skrivende deltager til kun læse. At give skriveadgang kræver en ny invitation, som alle parter skal godkende." : "Parties can remove extra participants or make a writer read only. Granting write access needs a new invitation that all parties approve."}</p>
      {me && <div className="row end"><button type="button" className="danger" onClick={() => act("leave_conversation", {}, da ? "Forlad samtalen? Du kan kun komme ind igen via en ny invitation. Det, du har skrevet, bliver hos de andre." : "Leave the conversation? You can only return with a new invitation. What you wrote stays with the others.")}>{da ? "Forlad samtalen" : "Leave conversation"}</button></div>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>);
}

function AddMember({ lang, conv, done, openPlans }: { lang: Lang; conv: string; done: () => void; openPlans: () => void }) {
  const da = lang === "da";
  const [email, setEmail] = useState(""); const [role, setRole] = useState("reader"); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string; plan?: boolean } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    let r; try { r = await callFn("invite-email", { action: "member", conversation_id: conv, email, role }); } catch { r = { status: 0, data: null as any }; }
    setBusy(false);
    if (r.status === 200) { setMsg({ ok: true, text: r.data?.data?.status === "sent" ? (da ? `Invitationen er sendt til ${email}.` : `Invitation sent to ${email}.`) : (da ? "Anmodningen er sendt. De øvrige i samtalen skal godkende, før personen inviteres." : "Request sent. The others must approve before the person is invited.") }); setEmail(""); done(); }
    else if (r.data?.error === "plan_required") setMsg({ ok: false, text: da ? "Kun brugere på planen Tekst + vedhæftninger (79 kr./md.) kan tilføje ekstra personer. Du kan skifte plan under Abonnement (testfunktion – ingen betaling)." : "Only users on Text + attachments (79 DKK/month) can add extra people. You can switch under Plan (test feature – no payment).", plan: true });
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
      {msg?.plan && <div className="row end"><button type="button" onClick={openPlans}>{da ? "Se planer" : "See plans"}</button></div>}
    </form>
  );
}


function NewPassword({ lang, done }: { lang: Lang; done: () => void }) {
  const da = lang === "da";
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [msg, setMsg] = useState(""); const [ok, setOk] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!passwordsMatch(pw, pw2)) { setMsg(pwText[lang].mismatch); return; }
    const r = await supabase.auth.updateUser({ password: pw });
    if (r.error) setMsg(da ? "Adgangskoden kunne ikke gemmes. Den skal være mindst 8 tegn." : "The password could not be saved. It must be at least 8 characters.");
    else { setOk(true); setMsg(da ? "Ny adgangskode gemt." : "New password saved."); }
  };
  if (ok) return <><p className="notice" role="status">{msg}</p><button type="button" onClick={done}>OK</button></>;
  return (<form onSubmit={submit}>
    <label htmlFor="np">{da ? "Ny adgangskode" : "New password"}</label><PasswordInput id="np" lang={lang} value={pw} onChange={setPw} minLength={8} autoComplete="new-password" />
    <label htmlFor="np2">{pwText[lang].repeat}</label><PasswordInput id="np2" lang={lang} value={pw2} onChange={setPw2} minLength={8} autoComplete="new-password" />
    {msg && <p className="err" role="alert">{msg}</p>}
    <button type="submit" style={{ marginTop: 12 }}>{da ? "Gem" : "Save"}</button>
  </form>);
}

function AccountPanel({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [email, setEmail] = useState("");
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? "")); }, []);
  const [cur, setCur] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [pwMsg, setPwMsg] = useState<[boolean, string] | null>(null);
  const [ne, setNe] = useState(""); const [ep, setEp] = useState(""); const [eMsg, setEMsg] = useState<[boolean, string] | null>(null); const [busy, setBusy] = useState(false);
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault(); setPwMsg(null);
    if (!passwordsMatch(pw, pw2)) { setPwMsg([false, pwText[lang].mismatch]); return; }
    setBusy(true);
    const re = await supabase.auth.signInWithPassword({ email, password: cur });
    if (re.error) { setBusy(false); setPwMsg([false, da ? "Nuværende adgangskode er forkert." : "Current password is wrong."]); return; }
    const r = await supabase.auth.updateUser({ password: pw }); setBusy(false);
    setPwMsg(r.error ? [false, da ? "Kunne ikke gemme. Mindst 8 tegn, og den skal være ny." : "Could not save. At least 8 characters, and it must be new."] : [true, da ? "Adgangskoden er skiftet." : "Password changed."]);
    if (!r.error) { setCur(""); setPw(""); setPw2(""); }
  };
  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault(); setEMsg(null); setBusy(true);
    let r; try { r = await callFn("account-mail", { action: "change_email", password: ep, new_email: ne }); } catch { r = { status: 0, data: null as any }; }
    setBusy(false);
    const err = r.data?.error;
    setEMsg(r.status === 200 ? [true, da ? `Vi har sendt et bekræftelseslink til ${ne}. E-mailen skiftes, når du trykker på linket. ${email} får besked om ændringen.` : `We sent a confirmation link to ${ne}. The email changes when you open it. ${email} is notified.`]
      : [false, err === "wrong_password" ? (da ? "Adgangskoden er forkert." : "Wrong password.")
        : err === "rate_limited" ? (da ? "For mange forsøg. Prøv igen om en time." : "Too many attempts. Try again in an hour.")
        : err === "email_taken" ? (da ? "Den e-mail kan ikke bruges." : "That email cannot be used.")
        : err === "test_mail_blocked" ? (da ? "I testversionen kan der kun sendes til godkendte testadresser." : "In the test version mail only goes to approved test addresses.")
        : (da ? "Noget gik galt. Prøv igen." : "Something went wrong. Try again.")]);
    if (r.status === 200) setEp("");
  };
  return (<>
    <p className="meta">{da ? "Din e-mail: " : "Your email: "}<strong>{email}</strong></p>
    <form onSubmit={changePw}>
      <h2>{da ? "Skift adgangskode" : "Change password"}</h2>
      <label htmlFor="cp">{da ? "Nuværende adgangskode" : "Current password"}</label><PasswordInput id="cp" lang={lang} value={cur} onChange={setCur} minLength={1} autoComplete="current-password" />
      <label htmlFor="cp1">{da ? "Ny adgangskode" : "New password"}</label><PasswordInput id="cp1" lang={lang} value={pw} onChange={setPw} minLength={8} autoComplete="new-password" />
      <label htmlFor="cp2">{pwText[lang].repeat}</label><PasswordInput id="cp2" lang={lang} value={pw2} onChange={setPw2} minLength={8} autoComplete="new-password" />
      {pwMsg && <p className={pwMsg[0] ? "notice" : "err"} role={pwMsg[0] ? "status" : "alert"}>{pwMsg[1]}</p>}
      <button type="submit" disabled={busy} style={{ marginTop: 12 }}>{da ? "Skift adgangskode" : "Change password"}</button>
    </form>
    <form onSubmit={changeEmail} style={{ marginTop: 24 }}>
      <h2>{da ? "Skift e-mail" : "Change email"}</h2>
      <label htmlFor="ne">{da ? "Ny e-mail" : "New email"}</label><input id="ne" type="email" required autoComplete="email" value={ne} onChange={(e) => setNe(e.target.value)} />
      <label htmlFor="ep">{da ? "Din adgangskode" : "Your password"}</label><PasswordInput id="ep" lang={lang} value={ep} onChange={setEp} minLength={1} autoComplete="current-password" />
      <p className="meta">{da ? "Vi sender et bekræftelseslink til den nye adresse og en besked til den nuværende." : "We send a confirmation link to the new address and a notice to the current one."}</p>
      {eMsg && <p className={eMsg[0] ? "notice" : "err"} role={eMsg[0] ? "status" : "alert"}>{eMsg[1]}</p>}
      <button type="submit" disabled={busy}>{da ? "Skift e-mail" : "Change email"}</button>
    </form>
  </>);
}

// ---------- Plans (TEST FEATURE: no payment) ----------
export const PLANS = [
  { id: "text", price: 49, da: ["Tekst", "Op til 160 tegn pr. besked med AI-tonetjek og samtale med den anden forælder. Du kan se vedhæftninger og deltage, når andre tilføjer dig."], en: ["Text", "Up to 160 characters per message with AI tone check. You can view attachments others send."] },
  { id: "text_attachments", price: 79, da: ["Tekst + vedhæftninger", "Op til 480 tegn pr. besked, og du kan sende screenshots, billeder og PDF'er (tjekket af AI før afsendelse) og tilføje ekstra personer til samtaler."], en: ["Text + attachments", "Up to 480 characters per message, plus sending screenshots, images and PDFs (checked by AI before sending) and adding extra people to conversations."] },
] as const;
function Plans({ lang }: { lang: Lang }) {
  const da = lang === "da";
  const [p, setP] = useState<{ plan: string; pending_plan: string | null; period_end: string | null; test_switch: boolean } | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => supabase.rpc("get_my_plan").then(({ data }) => setP(data?.[0] ?? null));
  useEffect(() => { load(); }, []);
  const change = async (plan: string, now = false) => {
    setBusy(true); setMsg("");
    const r = await supabase.rpc("set_my_plan_test", { p_plan: plan, p_now: now }); setBusy(false);
    if (r.error) { setMsg(da ? "Planen kunne ikke skiftes. Prøv igen." : "Could not change plan. Try again."); return; }
    const d = r.data?.[0]; await load();
    setMsg(d?.pending_plan ? (da ? `Skiftet er planlagt og gælder fra ${new Date(d.period_end).toLocaleDateString("da")}.` : `The change is scheduled from ${new Date(d.period_end).toLocaleDateString("en")}.`)
      : (da ? "Planen er skiftet." : "Plan changed."));
  };
  if (!p) return <p className="meta" role="status">{da ? "Henter…" : "Loading…"}</p>;
  const name = (id: string) => (PLANS.find((x) => x.id === id)![da ? "da" : "en"])[0];
  return (<div>
    <div className="notice" role="note"><strong>{da ? "TESTFUNKTION – ingen betaling." : "TEST FEATURE – no payment."}</strong> {da ? "Du kan skifte frit for at prøve planerne. Der trækkes ingen penge, og der er ikke koblet betaling på endnu." : "Switch freely to try the plans. Nothing is charged; no payment is connected yet."}</div>
    <div className="plans" role="list">
      {PLANS.map((x) => { const cur = p.plan === x.id; const [title, desc] = x[da ? "da" : "en"]; return (
        <section key={x.id} role="listitem" className={`card plan${cur ? " current" : ""}`} aria-current={cur ? "true" : undefined} aria-labelledby={`plan-${x.id}`}>
          <h3 id={`plan-${x.id}`}>{title}</h3>
          <p className="price"><strong>{x.price} kr.</strong> / {da ? "md." : "month"}</p>
          <p className="meta">{desc}</p>
          {cur ? <p className="badge">{da ? "Din nuværende plan" : "Your current plan"}</p>
            : <button disabled={busy || !p.test_switch} onClick={() => change(x.id)}>{x.id === "text_attachments" ? (da ? "Opgradér (test)" : "Upgrade (test)") : (da ? "Nedgradér (test)" : "Downgrade (test)")}</button>}
          {p.pending_plan === x.id && <p className="meta">{da ? "Skifter hertil ved næste periode." : "Switches here next period."}</p>}
        </section>); })}
    </div>
    {p.pending_plan && <div className="row"><button className="ghost" disabled={busy} onClick={() => change(p.plan)}>{da ? `Behold ${name(p.plan)}` : `Keep ${name(p.plan)}`}</button>
      <button className="ghost" disabled={busy} onClick={() => change(p.pending_plan!, true)}>{da ? "Skift straks (kun test)" : "Switch now (test only)"}</button></div>}
    <p className="meta">{da ? "Regel: Opgradering gælder straks. Nedgradering gælder fra næste periode (indtil da beholder du vedhæftninger). Planen gælder dig som afsender – den anden forælder kan have en anden plan. Alle kan altid se vedhæftninger, de modtager." : "Rule: upgrades apply immediately. Downgrades apply from the next period. The plan applies to you as sender – the other parent may have another plan. Everyone can always view attachments they receive."}</p>
    {p.period_end && <p className="meta">{da ? "Periode slutter" : "Period ends"}: {new Date(p.period_end).toLocaleDateString(lang)}</p>}
    {msg && <p className="notice" role="status">{msg}</p>}
  </div>);
}

// ---------- Attachments ----------
function AttachBar({ lang, conv, plan, openPlans, caption, file, setFile, sendRef, cap, replyTo, onBusy, sent, limitMsg }: { lang: Lang; conv: string; plan: string | null; openPlans: () => void; caption: string; file: File | null; setFile: (file: File | null) => void; sendRef: React.MutableRefObject<(() => void) | null>; cap: number; replyTo: string | null; onBusy: (value: boolean) => void; sent: (messageId?: string) => void; limitMsg: (d: any) => string | null }) {
  const da = lang === "da";
  const [alt, setAlt] = useState(""); const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setOut(null); setAlt(""); }, [file]);
  const reasons: Record<string, string> = da ? { inappropriate_image: "billedet kan opfattes som upassende", controlling_demand: "teksten dikterer hvad den anden skal gøre", personal_attack: "teksten indeholder et personangreb", sarcasm_or_irony: "teksten er sarkastisk på en sårende måde", humiliation_mockery: "teksten er nedgørende", threat_intimidation: "teksten kan opfattes som en trussel", emotional_blackmail: "teksten lægger pres", false_politeness: "teksten er falsk høflig", slur_discrimination: "teksten er diskriminerende", other_harmful: "teksten kan opfattes som sårende eller aggressiv" }
    : { inappropriate_image: "the image may be inappropriate", controlling_demand: "the text dictates what the other person must do", personal_attack: "the text contains a personal attack", sarcasm_or_irony: "the text is hurtfully sarcastic", humiliation_mockery: "the text is belittling", threat_intimidation: "the text may read as a threat", emotional_blackmail: "the text applies pressure", false_politeness: "the text is falsely polite", slur_discrimination: "the text is discriminatory", other_harmful: "the text may come across as hurtful or aggressive" };
  const errs: Record<string, string> = da ? { too_large: "Filen er for stor (højst 4 MB).", bad_type: "Kun PNG, JPG, WebP, GIF (ikke animeret) og PDF.", animated: "Animerede billeder kan ikke sendes.", too_many_pages: "PDF'en må højst have 5 sider.", encrypted_pdf: "Krypterede PDF'er kan ikke sendes.", empty: "Filen er tom.", read_only: "Du har rollen “Kun læse” og kan ikke sende.", rate_limited: "Du har sendt mange filer. Vent lidt og prøv igen.", plan_required: "Vedhæftninger kræver planen Tekst + vedhæftninger (79 kr./md.).", length: "Teksten er for lang (højst 480 tegn med vedhæftning)." }
    : { too_large: "File too large (max 4 MB).", bad_type: "Only PNG, JPG, WebP, GIF (not animated) and PDF.", animated: "Animated images cannot be sent.", too_many_pages: "PDF max 5 pages.", encrypted_pdf: "Encrypted PDFs cannot be sent.", empty: "The file is empty.", read_only: "You are read-only.", rate_limited: "Too many files. Wait and try again.", plan_required: "Attachments require the Text + attachments plan (79 DKK/month).", length: "Text too long (max 480 characters with an attachment)." };
  const send = async () => {
    if (!file || busy || count(caption) > cap) return;
    if (plan !== "text_attachments") { openPlans(); return; }
    setBusy(true); onBusy(true); setOut(null);
    let buf: Uint8Array;
    try { buf = new Uint8Array(await file.arrayBuffer()); } catch { setBusy(false); onBusy(false); setOut({ ok: false, text: da ? "Filen kunne ikke læses. Vælg den igen." : "Could not read the file. Please select it again." }); return; }
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    let r; try { r = await callFn("send-attachment", { conversation_id: conv, idempotency_key: crypto.randomUUID(), file_b64: btoa(bin), file_name: file.name, reply_to_id: replyTo, caption: caption.trim(), alt: alt.trim() }); } catch { r = { status: 0, data: null as any }; }
    setBusy(false); onBusy(false); const d = r.data ?? {};
    if (r.status === 200 && d.status === "accepted") { setFile(null); setAlt(""); setOut({ ok: true, text: da ? "Vedhæftningen er sendt." : "Attachment sent." }); sent(typeof d.message_id === "string" ? d.message_id : undefined); }
    else if (limitMsg(d)) setOut({ ok: false, text: limitMsg(d)! });
    else if (d.status === "clarification_required") setOut({ ok: false, text: da ? "Filen er ikke sendt. Vi er usikre på, hvad du mener. Vil du gøre teksten i filen eller din billedtekst lidt tydeligere?" : "Your file was not sent. We’re not sure what you mean. Could you make the text in the file or your caption a little clearer?" });
    else if (d.status === "blocked") setOut({ ok: false, text: (da ? "Filen blev ikke sendt: " : "Not sent: ") + (reasons[d.reason_code] ?? reasons.other_harmful) + "." + ((d.spans ?? []).length ? (da ? " Markeret: “" : " Flagged: “") + d.spans.join("”, “") + "”" : "") + (typeof d.suggestion === "string" && d.suggestion ? (da ? " Forslag: " : " Suggestion: ") + d.suggestion : "") });
    else if (d.status === "private_boundary") setOut({ ok: false, text: da ? "Filen blev ikke sendt på grund af en privat modtagerindstilling." : "Not sent due to a private recipient setting." });
    else if (d.status === "blocked_word") setOut({ ok: false, text: da ? `Filen blev ikke sendt: Modtageren har blokeret ordet/sætningen "${d.word}", og det står i ${d.where === "caption" ? "din tekst" : "filen"}.` : `Not sent: the recipient blocked "${d.word}", which appears in ${d.where === "caption" ? "your text" : "the file"}.` });
    else if (d.status === "rule") setOut({ ok: false, text: da ? "Filen blev ikke sendt: Din tekst overholder ikke reglerne (emojis, store bogstaver eller gentagelse)." : "Not sent: your text breaks the rules (emoji, caps or repetition)." });
    else if (d.status === "cannot_deliver") setOut({ ok: false, text: da ? "Der kan ikke sendes i denne samtale." : "Cannot send in this conversation." });
    else if (d.error && errs[d.error]) { setOut({ ok: false, text: errs[d.error] }); if (d.error === "plan_required") openPlans(); }
    else setOut({ ok: false, text: da ? "Teknisk fejl: Filen blev ikke tjekket og derfor ikke sendt. Prøv igen senere." : "Technical error: the file was not checked and therefore not sent." });
  };
  useEffect(() => { sendRef.current = send; return () => { sendRef.current = null; }; });
  return (<div className="attach">
    {file && <div>
      <p className="meta" style={{ margin: "4px 0" }}>{file.name} · {Math.ceil(file.size / 1024)} kB</p>
      <label htmlFor={`alt-${conv}`}>{da ? "Kort beskrivelse (alt-tekst til skærmlæsere)" : "Short description (alt text for screen readers)"}</label>
      <input id={`alt-${conv}`} maxLength={300} value={alt} onChange={e => setAlt(e.target.value)} />
      <p className="meta">{da ? "Filen og teksten i den tjekkes af AI før afsendelse. I testen må du kun bruge opdigtet indhold. Beskedfeltet sendes med som billedtekst." : "The file and its text are checked by AI before sending. Use synthetic content only in the test. The message is sent as its caption."}</p>
      <button type="button" className="ghost" disabled={busy} onClick={() => { setFile(null); setAlt(""); setOut(null); }}>{da ? "Fjern fil" : "Remove file"}</button>
    </div>}
    {out && <div className="notice" role={out.ok ? "status" : "alert"}>{out.text}</div>}
  </div>);
}
function AttachmentView({ lang, m }: { lang: Lang; m: Msg }) {
  const da = lang === "da"; const [url, setUrl] = useState<string | null>(null); const [err, setErr] = useState(false);
  const isPdf = m.att_mime === "application/pdf"; const alt = m.att_alt || (da ? `Vedhæftet billede: ${m.att_name}` : `Attached image: ${m.att_name}`);
  const open = async () => {
    const { data, error } = await supabase.rpc("get_attachment", { p_message: m.id });
    if (error || !data?.[0]) { setErr(true); return; }
    const bin = atob(data[0].data_b64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    const u = URL.createObjectURL(new Blob([b], { type: data[0].mime })); if (isPdf) window.open(u, "_blank", "noopener"); else setUrl(u);
  };
  return (<div className="att">
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", borderRadius: 8 }} />
      : <button className="ghost" onClick={open}>{isPdf ? (da ? `Åbn PDF: ${m.att_name} (${m.att_pages} s.)` : `Open PDF: ${m.att_name} (${m.att_pages} p.)`) : (da ? `Vis billede: ${m.att_name}` : `Show image: ${m.att_name}`)}</button>}
    {err && <p className="meta" role="alert">{da ? "Vedhæftningen kunne ikke hentes." : "Could not load the attachment."}</p>}
  </div>);
}

type SendLimits = { max_chars: number | null; chars_by: string | null; next_at: string | null; next_by: string | null; multi: boolean };
function waitText(secs: number, da: boolean) {
  if (secs < 60) return da ? `om ${secs} sek.` : `in ${secs} s`;
  const m = Math.ceil(secs / 60); if (m < 120) return da ? `om ${m} min` : `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60; return da ? `om ${h} t${r ? ` ${r} min` : ""}` : `in ${h} h${r ? ` ${r} min` : ""}`;
}
export const FREQ_MAX = 1440;
function PersonSettings({ lang, sender, label, openWords }: { lang: Lang; sender: string; label: string; openWords: () => void }) {
  const da = lang === "da"; const id = sender.slice(0, 8);
  const [fr, setFr] = useState("none"); const [frC, setFrC] = useState("");
  const [cur, setCur] = useState<{ interval_min: number | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const apply = (r: { interval_min: number | null }) => {
    setCur(r); const f = r.interval_min;
    if (f == null) setFr("none"); else if ([1, 5, 60].includes(f)) setFr(String(f)); else { setFr("custom"); setFrC(String(f)); }
  };
  useEffect(() => { supabase.from("person_limits").select("interval_min").eq("sender_id", sender).maybeSingle().then(({ data }) => apply(data ?? { interval_min: null })); }, [sender]);
  const desc = (r: { interval_min: number | null }) => (da ? `Frekvens: ${r.interval_min ? `højst 1 besked pr. ${r.interval_min} min` : "ingen grænse"}.` : `Frequency: ${r.interval_min ? `at most 1 message per ${r.interval_min} min` : "no limit"}.`);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    const iv: number | null = fr === "none" ? null : fr === "custom" ? Number(frC) : Number(fr);
    if (iv !== null && (!Number.isInteger(iv) || iv < 1 || iv > FREQ_MAX)) { setMsg({ ok: false, text: da ? `Intervallet skal være et helt antal minutter fra 1 til ${FREQ_MAX} (24 timer).` : `The interval must be whole minutes from 1 to ${FREQ_MAX} (24 hours).` }); return; }
    setBusy(true); const { error } = await supabase.rpc("set_person_limit", { p_sender: sender, p_max_chars: null, p_interval_min: iv }); setBusy(false);
    if (error) { setMsg({ ok: false, text: da ? "Indstillingen kunne ikke gemmes." : "Could not save." }); return; }
    apply({ interval_min: iv }); setMsg({ ok: true, text: (da ? "Gemt. Gælder nye beskeder fra " : "Saved. Applies to new messages from ") + label + ". " + desc({ interval_min: iv }) });
  };
  return (<form className="card" onSubmit={save} aria-label={(da ? "Indstillinger for " : "Settings for ") + label} style={{ marginTop: 6 }}>
    <p className="meta" style={{ marginTop: 0 }}>{da ? `Gælder beskeder fra ${label} til dig – i alle jeres samtaler. ${label} ser ventetiden, når grænsen rammer.` : `Applies to messages from ${label} to you – in all your conversations. ${label} sees the waiting time when the limit applies.`}</p>
    {cur && <p role="status"><strong>{da ? "Nu: " : "Now: "}</strong>{desc(cur)}</p>}
    <fieldset><legend>{da ? "Hvor ofte må der komme en besked" : "How often messages may arrive"}</legend>
      <Choice name={`fr-${id}`} value={fr} set={setFr} opts={[["none", da ? "Ingen grænse (standard)" : "No limit (default)"], ["1", da ? "1 pr. minut" : "1 per minute"], ["5", da ? "1 pr. 5 minutter" : "1 per 5 minutes"], ["60", da ? "1 pr. time" : "1 per hour"], ["custom", da ? "Brugerdefineret" : "Custom"]]} />
      {fr === "custom" && <><label htmlFor={`frc-${id}`}>{da ? `Minutter mellem beskeder (1–${FREQ_MAX})` : `Minutes between messages (1–${FREQ_MAX})`}</label><input id={`frc-${id}`} type="number" inputMode="numeric" min={1} max={FREQ_MAX} step={1} required value={frC} onChange={(e) => setFrC(e.target.value)} /></>}
    </fieldset>
    <p className="meta">{da ? "Er I flere i samtalen, gælder den længste ventetid blandt modtagerne for afsenderen. Vedhæftninger tæller som en besked. Ændringer gælder kun nye beskeder." : "With several recipients, the longest waiting time applies to the sender. Attachments count as one message. Changes apply to new messages only."}</p>
    <p className="meta">{da ? "Blokerede ord og sætninger gælder for hele denne samtale: " : "Blocked words and phrases apply to this whole conversation: "}<button type="button" className="linkish" onClick={openWords}>{da ? "Blokerede ord" : "Blocked words"}</button></p>
    <div className="row end"><button type="submit" disabled={busy}>{busy ? (da ? "Gemmer…" : "Saving…") : (da ? "Gem" : "Save")}</button></div>
    {msg && <p className={msg.ok ? "notice" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
  </form>);
}

// ---------- Add to home screen (PWA). No service worker → nothing cached. ----------
let deferredPrompt: any = null; const a2hsListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; a2hsListeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { localStorage.setItem(A2HS_KEY, "installed"); deferredPrompt = null; a2hsListeners.forEach((f) => f()); });
}
function InstallPrompt({ lang }: { lang: Lang }) {
  const da = lang === "da"; const [, re] = useState(0); const [hide, setHide] = useState(false);
  useEffect(() => { const f = () => re((x) => x + 1); a2hsListeners.add(f); return () => { a2hsListeners.delete(f); }; }, []);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  const kind = a2hsPlatform(navigator.userAgent, standalone, !!deferredPrompt);
  if (hide || kind === "none" || !shouldAsk(localStorage.getItem(A2HS_KEY), Date.now())) return null;
  const later = () => { localStorage.setItem(A2HS_KEY, `later:${Date.now()}`); setHide(true); };
  const never = () => { localStorage.setItem(A2HS_KEY, "never"); setHide(true); };
  const install = async () => { const p = deferredPrompt; if (!p) return; p.prompt(); const r = await p.userChoice.catch(() => null); deferredPrompt = null; if (r?.outcome === "accepted") localStorage.setItem(A2HS_KEY, "installed"); setHide(true); };
  return (<section className="card a2hs" aria-labelledby="a2hs-h">
    <div className="row" style={{ alignItems: "center", gap: 12 }}><img src="./icons/rolff-192.png" alt="" width={48} height={48} style={{ borderRadius: 12 }} />
      <h2 id="a2hs-h" style={{ margin: 0, fontSize: 18 }}>{da ? "Vil du tilføje Rolff som ikon på hjemmeskærmen?" : "Add Rolff to your home screen?"}</h2></div>
    {kind === "ios" ? <p>{da ? "Tryk på Del-knappen (firkant med pil op) nederst i Safari, og vælg “Føj til hjemmeskærm”." : "Tap the Share button (square with arrow) in Safari, then “Add to Home Screen”."}</p>
      : <p>{da ? "Så åbner Rolff som en app – uden adresselinje." : "Rolff then opens like an app."}</p>}
    <div className="row end">
      <button type="button" className="ghost" onClick={never}>{da ? "Spørg ikke igen" : "Don't ask again"}</button>
      <button type="button" className="ghost" onClick={later}>{da ? "Ikke nu" : "Not now"}</button>
      {kind === "prompt" && <button type="button" onClick={install}>{da ? "Installér" : "Install"}</button>}
    </div>
  </section>);
}

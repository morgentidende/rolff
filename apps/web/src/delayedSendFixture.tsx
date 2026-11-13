import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ComposerInput } from "./ComposerInput";
import { MessageBubble, type Message } from "./MessageBubble";
import { countdownAria } from "./delayedSend";
import "./styles.css";

const params = new URLSearchParams(location.search);
const lang = params.get("lang") === "en" ? "en" : "da";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const view = params.get("view") === "menu" || params.get("view") === "pending" ? params.get("view")! : "countdown";
document.documentElement.lang = lang;
document.documentElement.dataset.theme = theme;
document.documentElement.style.setProperty("--app-h", "844px");

const now = Date.parse("2026-11-13T08:00:00.000Z");
const deliverAfter = new Date(now + 27_000).toISOString();

const theirs: Message = {
  id: "t1", sender_id: "a", sender_name: "Alex", sender_email: "alex@example.invalid",
  body: lang === "da" ? "Kan vi mødes kl. 16?" : "Can we meet at 4 pm?",
  created_at: "2026-11-13T07:58:00.000Z", mine: false,
};
const pending: Message = {
  id: "p1", sender_id: "me", sender_name: "Dig", sender_email: "me@example.invalid",
  body: lang === "da" ? "Ja, jeg er der kl. 16." : "Yes, I will be there at 4.",
  created_at: "2026-11-13T08:00:00.000Z", mine: true, deliver_after: deliverAfter,
};

function MenuOpen() {
  const da = lang === "da";
  const items = [
    { label: da ? "Forsinkede beskeder" : "Delayed messages", checked: true },
    { label: da ? "Deltagere og roller" : "Participants and roles" },
    { label: da ? "Eksportér samtale" : "Export conversation" },
    { label: da ? "Blokeringer" : "Blocking lists" },
  ];
  return (
    <div className="menuwrap">
      <button type="button" className="icon" aria-label="Menu" aria-haspopup="menu" aria-expanded={true}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
      </button>
      <div className="menu" role="menu">
        {items.map((it) => (
          <button key={it.label} type="button" role={it.checked ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} className="">
            <span className="menu-label">{it.label}</span>
            {it.checked ? <svg className="menu-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" /></svg> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Fixture() {
  const da = lang === "da";
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const title = da ? "Alex" : "Alex";
  return (
    <main className="wrap chat-wrap" data-view={view}>
      <p className="notice" role="note">{da ? "Opdigtet testdata. Intet sendes." : "Mocked test data. Nothing is sent."}</p>
      <header className="topbar chat">
        <button type="button" className="icon" aria-label={da ? "Tilbage" : "Back"}>‹</button>
        <div role="heading" aria-level={2} className="chattitle"><span className="convname">{title}</span></div>
        {view === "menu" ? <MenuOpen /> : <button type="button" className="icon" aria-label="Menu"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg></button>}
      </header>
      <div className="msgs">
        <MessageBubble m={theirs} lang={lang} tailed onReply={() => {}} />
        <MessageBubble m={pending} lang={lang} tailed pendingSec={27} onReply={() => {}} onEdit={() => {}} onDelete={() => {}} />
      </div>
      <div className="card composer">
        <ComposerInput
          lang={lang}
          text={text}
          onText={setText}
          textareaRef={ref}
          plan="text"
          cap={160}
          busy={false}
          file={null}
          onFile={() => {}}
          openPlans={() => {}}
          canSend={!!text.trim()}
          countdownUntil={view === "menu" ? null : deliverAfter}
          onSend={() => {}}
          onSendNow={() => {}}
        />
      </div>
      <span className="sr-only">{countdownAria(lang, 27)}</span>
    </main>
  );
}

// Freeze "now" so the 27 s countdown and ring stay still in screenshots.
Date.now = () => now;

createRoot(document.getElementById("root")!).render(<Fixture />);

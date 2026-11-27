import { useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import { getContactEmailPicker } from "./native/contactPicker";

/** Button by the invite email field, plus a chooser if the contact has several emails. Hidden when no picker is available. */
export function useInviteContactPick(lang: Lang, onPick: (email: string) => void): { button: ReactNode; panel: ReactNode } {
  const da = lang === "da";
  const picker = getContactEmailPicker();
  const [choices, setChoices] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const supported = picker.supported();
  const run = async () => {
    setErr("");
    setChoices([]);
    try {
      const emails = await picker.pickEmails();
      if (emails.length === 0) return;
      if (emails.length === 1) onPick(emails[0]);
      else setChoices(emails);
    } catch {
      setErr(da ? "Kontakten kunne ikke åbnes. Skriv e-mailen selv." : "Could not open contacts. Type the email instead.");
    }
  };
  const button = supported
    ? <button type="button" className="textbtn strong contact-pick" onClick={() => void run()}>{da ? "Vælg fra kontakter" : "Choose from contacts"}</button>
    : null;
  const panel = (
    <>
      {choices.length > 1 && (
        <div className="contact-emails" role="group" aria-label={da ? "Vælg en e-mail" : "Choose an email"}>
          <p className="meta">{da ? "Kontakten har flere e-mails. Vælg en." : "This contact has several emails. Choose one."}</p>
          {choices.map((email) => (
            <button type="button" key={email} className="ghost contact-email-opt" onClick={() => { onPick(email); setChoices([]); }}>{email}</button>
          ))}
        </div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </>
  );
  return { button, panel };
}

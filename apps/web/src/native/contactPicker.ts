// Pick one contact's email for the invite fields.
//
// The invite UI talks only to ContactEmailPicker. It never lists the whole
// address book, never asks for a contacts permission, and never stores or
// uploads what was picked — the chosen address is written into the email
// field, and that is all.
//
// Adapters, first match wins:
//  1. A test double installed with setContactEmailPicker().
//  2. A native plugin on the Capacitor (or similar) bridge, if present.
//     iOS should present CNContactPickerViewController (email property only).
//     Android should present the system contact picker. Neither should
//     request READ_CONTACTS / full-book access. A future Flutter shell can
//     implement the same interface and call setContactEmailPicker().
//  3. The Web Contact Picker API (navigator.contacts.select), which today
//     exists on Android Chrome. The button is hidden when this is missing
//     (notably iPhone Safari / a plain webapp on iOS).
//
// Android Chrome (especially Samsung) does not always return email as a
// plain string array on ContactInfo.email. uniqueEmails() walks the whole
// select() result and accepts strings, mailto:, "Name <addr>", and objects
// with email/emails/address/value. While the system sheet is open, a
// popstate (Android Back / the picker closing) must not dismiss the invite
// card, and the chosen address is kept in a short-lived draft so it still
// fills the field if the card remounts when the page becomes visible again.
import { plugin } from "./platform";
import { holdBackDismiss } from "../backNavigation";

export type ContactEmailPicker = {
  /** True when a system or native picker can be shown right now. */
  supported(): boolean;
  /**
   * Open the picker for a single contact and return that contact's emails.
   * An empty array means the user cancelled. If a contact was chosen but had
   * no usable email, the promise rejects with Error("no_email").
   */
  pickEmails(): Promise<string[]>;
};

const LOOKS_LIKE_EMAIL = /[^\s@<>",;:]+@[^\s@<>",;:]+/g;

function addEmail(raw: string, acc: string[], seen: Set<string>): void {
  let t = raw.trim().replace(/^mailto:/i, "").replace(/^["']|["']$/g, "").trim();
  if (!t) return;
  const found = t.match(LOOKS_LIKE_EMAIL);
  const parts = found && found.length ? found : t.includes("@") ? [t] : [];
  for (const part of parts) {
    const email = part.replace(/[>,;]+$/g, "").trim();
    if (!email || !email.includes("@")) continue;
    const key = email.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    acc.push(email);
  }
}

function collectEmails(raw: unknown, acc: string[], seen: Set<string>, depth: number): void {
  if (raw == null || depth > 6) return;
  if (typeof raw === "string" || typeof raw === "number") {
    addEmail(String(raw), acc, seen);
    return;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) collectEmails(item, acc, seen, depth + 1);
    return;
  }
  if (typeof raw !== "object") return;
  const o = raw as Record<string, unknown>;
  for (const key of ["email", "emails", "address", "value", "addr"]) {
    if (key in o) collectEmails(o[key], acc, seen, depth + 1);
  }
  for (const [key, val] of Object.entries(o)) {
    if (key === "email" || key === "emails" || key === "address" || key === "value" || key === "addr") continue;
    if (typeof val === "string" || typeof val === "number" || Array.isArray(val) || (val && typeof val === "object")) {
      collectEmails(val, acc, seen, depth + 1);
    }
  }
}

/** Deduped email addresses from a Contact Picker result, a native plugin payload, or a loose list. */
export function uniqueEmails(raw: unknown): string[] {
  const acc: string[] = [];
  collectEmails(raw, acc, new Set<string>(), 0);
  return acc;
}

function isCancel(e: unknown): boolean {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
  return name === "AbortError" || name === "NotAllowedError";
}

function releaseLater(release: () => void): void {
  // The system sheet can fire popstate just after select() resolves.
  const t = setTimeout(release, 500) as unknown as { unref?: () => void };
  t.unref?.();
}

function webPicker(): ContactEmailPicker {
  const contacts = () => (typeof navigator !== "undefined" ? (navigator as Navigator & { contacts?: { select?: Function; getProperties?: Function } }).contacts : undefined);
  return {
    supported: () => typeof contacts()?.select === "function",
    pickEmails: async () => {
      const release = holdBackDismiss();
      try {
        // Request name as well: some Android Chrome builds returned an empty
        // email list when only "email" was asked for, even after the user
        // shared a Mailadresse on the "Del en kontakt" sheet.
        const picked = await contacts()!.select!(["name", "email"], { multiple: false });
        if (!Array.isArray(picked) || picked.length === 0) return [];
        const emails = uniqueEmails(picked);
        if (emails.length === 0) throw new Error("no_email");
        return emails;
      } catch (e) {
        if (isCancel(e)) return [];
        throw e;
      } finally {
        releaseLater(release);
      }
    },
  };
}

function nativePicker(): ContactEmailPicker | null {
  // Expected plugin surface (to be implemented in the native shell):
  //   pickEmails(): Promise<string[] | { email?: string[] }>
  const p = plugin("ContactPicker") ?? plugin("RolffContacts");
  const pick = p?.pickEmails ?? p?.selectEmail;
  if (typeof pick !== "function") return null;
  return {
    supported: () => true,
    pickEmails: async () => {
      const release = holdBackDismiss();
      try {
        const raw = await pick.call(p);
        if (raw == null) return [];
        const emails = uniqueEmails(raw);
        const emptyObject = raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw as object).length === 0;
        const emptyArray = Array.isArray(raw) && raw.length === 0;
        if (emails.length === 0 && !emptyObject && !emptyArray && raw !== "") throw new Error("no_email");
        return emails;
      } catch (e) {
        if (isCancel(e)) return [];
        throw e;
      } finally {
        releaseLater(release);
      }
    },
  };
}

let override: ContactEmailPicker | null = null;

/** Tests and a future native/Flutter shell can replace the active adapter. */
export function setContactEmailPicker(next: ContactEmailPicker | null): void {
  override = next;
}

export function getContactEmailPicker(): ContactEmailPicker {
  return override ?? nativePicker() ?? webPicker();
}

export type InviteDraftKey = "front" | "member";
const DRAFT_PREFIX = "rolff.inviteEmail.";
const draftMem: Partial<Record<InviteDraftKey, string>> = {};
const draftSubs = new Set<(key: InviteDraftKey, email: string) => void>();

/** Remember the address just picked, so a remount of the invite card still fills the field. Not a contact list; cleared on send or log out. */
export function setInviteEmailDraft(key: InviteDraftKey, email: string): void {
  const next = email.trim();
  if (next) draftMem[key] = next; else delete draftMem[key];
  try {
    if (next) sessionStorage.setItem(DRAFT_PREFIX + key, next);
    else sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch { /* private mode */ }
  draftSubs.forEach((fn) => fn(key, next));
}

export function getInviteEmailDraft(key: InviteDraftKey): string {
  if (draftMem[key]) return draftMem[key]!;
  try { return sessionStorage.getItem(DRAFT_PREFIX + key) ?? ""; } catch { return ""; }
}

export function clearInviteEmailDrafts(): void {
  setInviteEmailDraft("front", "");
  setInviteEmailDraft("member", "");
}

export function subscribeInviteEmailDraft(fn: (key: InviteDraftKey, email: string) => void): () => void {
  draftSubs.add(fn);
  return () => { draftSubs.delete(fn); };
}

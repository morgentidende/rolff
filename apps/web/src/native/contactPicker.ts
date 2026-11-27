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
import { plugin } from "./platform";

export type ContactEmailPicker = {
  /** True when a system or native picker can be shown right now. */
  supported(): boolean;
  /**
   * Open the picker for a single contact and return that contact's emails.
   * An empty array means the user cancelled or the contact had no email.
   */
  pickEmails(): Promise<string[]>;
};

export function uniqueEmails(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const email = String(item ?? "").trim();
    if (!email) continue;
    const key = email.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function isCancel(e: unknown): boolean {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
  return name === "AbortError" || name === "NotAllowedError";
}

function webPicker(): ContactEmailPicker {
  const contacts = () => (typeof navigator !== "undefined" ? (navigator as Navigator & { contacts?: { select?: Function } }).contacts : undefined);
  return {
    supported: () => typeof contacts()?.select === "function",
    pickEmails: async () => {
      try {
        const picked = await contacts()!.select!(["email"], { multiple: false }) as { email?: unknown }[];
        return uniqueEmails(picked?.[0]?.email);
      } catch (e) {
        if (isCancel(e)) return [];
        throw e;
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
      try {
        const raw = await pick.call(p);
        if (Array.isArray(raw)) return uniqueEmails(raw);
        if (raw && typeof raw === "object" && "email" in raw) return uniqueEmails((raw as { email?: unknown }).email);
        return uniqueEmails(raw);
      } catch (e) {
        if (isCancel(e)) return [];
        throw e;
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

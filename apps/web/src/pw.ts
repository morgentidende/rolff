// Pure helpers for password fields (unit-tested with deno in CI).
export type PwLang = "da" | "en";
export const pwText = {
  da: { show: "Vis kodeord", hide: "Skjul kodeord", repeat: "Gentag adgangskode", mismatch: "Koderne er ikke ens", match: "Koderne er ens" },
  en: { show: "Show password", hide: "Hide password", repeat: "Repeat password", mismatch: "Passwords do not match", match: "Passwords match" },
};
/** Signup may only submit when both fields are non-empty and identical. */
export const passwordsMatch = (a: string, b: string) => a.length > 0 && a === b;
/** Live status under a new-password + repeat pair. Empty until the repeat field has text. */
export type PasswordPairState = "empty" | "match" | "mismatch";
export const passwordPairState = (a: string, b: string): PasswordPairState =>
  b.length === 0 ? "empty" : passwordsMatch(a, b) ? "match" : "mismatch";
export const toggleLabel = (lang: PwLang, visible: boolean) => visible ? pwText[lang].hide : pwText[lang].show;

// Pure helpers for password fields (unit-tested with deno in CI).
export type PwLang = "da" | "en";
export const pwText = {
  da: { show: "Vis kodeord", hide: "Skjul kodeord", repeat: "Gentag kodeord", mismatch: "Kodeordene er ikke ens. Skriv det samme kodeord i begge felter." },
  en: { show: "Show password", hide: "Hide password", repeat: "Repeat password", mismatch: "The passwords do not match. Type the same password in both fields." },
};
/** Signup may only submit when both fields are non-empty and identical. */
export const passwordsMatch = (a: string, b: string) => a.length > 0 && a === b;
export const toggleLabel = (lang: PwLang, visible: boolean) => visible ? pwText[lang].hide : pwText[lang].show;

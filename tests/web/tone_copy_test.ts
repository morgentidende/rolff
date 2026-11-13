// User-facing tone copy: no "ordre"/"dikterer"/"pressende" wording; moderation rule itself is unchanged elsewhere.
const files = ["apps/web/src/i18n.ts", "apps/web/src/App.tsx", "apps/web/public/privatliv.html", "apps/web/src/BlockedNotice.tsx"];
const read = (f: string) => Deno.readTextFileSync(f);
Deno.test("no ordre/dikter/pressende wording in user-facing copy", () => {
  for (const f of files) {
    const s = read(f);
    for (const bad of [/\bordre\b/i, /dikter/i, /pressende/i, /pressuring/i, /as an order/i, /dictate/i]) if (bad.test(s)) throw new Error(`${f}: ${bad}`);
  }
});
Deno.test("new tone copy present (da + en)", () => {
  const i18n = read(files[0]), app = read(files[1]), priv = read(files[2]);
  for (const [s, want] of [
    [i18n, "Beskeden blev ikke sendt, fordi tonen kan opfattes som sårende. Ret den og prøv igen."],
    [i18n, "The message was not sent because its tone may come across as hurtful. Edit it and try again."],
    [app, 'controlling_demand: "teksten kan unødigt provokere til vrede"'],
    [app, 'controlling_demand: "the text may needlessly provoke anger"'],
    [app, "Før en besked sendes, vurderer en AI-tjeneste tonen. Bliver"],
    [app, "beskeder, der kan opfattes som sårende eller unødigt kan provokere til vrede (tjekket af AI), beskeder med emojis"],
    [app, "messages that may come across as hurtful or needlessly provoke anger (checked by AI), messages with emojis"],
    [priv, "Beskeder kan afvises, hvis tonen kan opfattes som sårende eller unødigt kan provokere til vrede."],
  ] as [string, string][]) if (!s.includes(want)) throw new Error("missing: " + want);
});

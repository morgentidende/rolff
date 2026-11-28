/** Copy for the Premium → Standard confirmation card. */
export type PlanLang = "da" | "en";
export type DowngradeWhen = { immediate?: boolean; periodEndLabel?: string | null };

export function downgradeConfirmCopy(lang: PlanLang, o: DowngradeWhen = {}): {
  title: string;
  body: string;
  points: string[];
  dismiss: string;
  confirm: string;
} {
  const da = lang === "da";
  const body = o.immediate
    ? (da ? "Ændringen gælder med det samme. Du mister det her:" : "The change applies immediately. You will lose the following:")
    : o.periodEndLabel
      ? (da ? `Fra ${o.periodEndLabel} gælder Standard, og du mister det her:` : `From ${o.periodEndLabel}, Standard applies, and you will lose the following:`)
      : (da ? "Ændringen gælder fra næste periode. Fra da mister du det her:" : "The change applies from the next period. From then, you will lose the following:");
  return {
    title: da ? "Nedgradér til Standard?" : "Downgrade to Standard?",
    body,
    points: da
      ? [
        // Truthful for the current web/test build: cloud_sync is set to false when
        // Standard takes effect. There is no sync_keys table yet, and turning sync
        // off does not delete messages already on the server.
        "Sky-synk slås fra. Beskeder, der allerede ligger på serveren, bliver. Du kan ikke bruge Rolff på flere enheder med synk.",
        "Du kan højst skrive 160 tegn pr. besked (i stedet for 480).",
        "Du kan ikke længere sende screenshots, billeder eller PDF'er. Du kan stadig se vedhæftninger, du modtager.",
        "Du kan ikke tilføje ekstra personer til samtaler. Dem, der allerede er med, bliver.",
      ]
      : [
        "Cloud sync is turned off. Messages already on the server are kept. You will not be able to use Rolff on several devices with sync.",
        "You can write at most 160 characters per message (instead of 480).",
        "You can no longer send screenshots, images or PDFs. You can still see attachments you receive.",
        "You cannot add extra people to conversations. Anyone already in them stays.",
      ],
    dismiss: da ? "Behold Premium" : "Keep Premium",
    confirm: da ? "Nedgradér" : "Downgrade",
  };
}

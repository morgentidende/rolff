// Texts and state for pending invitations (resend, copy link, expired, mail failures). da + en.
export type InvLang = "da" | "en";
export type PendingInv = { id: string; role: string; invitee_email: string | null; expires_at?: string; consents: number; required: number; i_consented: boolean; mine: boolean; expired?: boolean; mail_failed?: boolean; can_manage?: boolean };

/** What a row can offer. Resend/copy need everyone's approval and a parent caller. */
export function invActions(iv: PendingInv) {
  const ready = iv.consents >= iv.required;
  const manage = !!iv.can_manage;
  return {
    resend: ready && manage,
    copyLink: ready && manage,
    remove: !!iv.expired && manage,
    approve: !iv.expired && !iv.i_consented,
    withdraw: !iv.expired && iv.i_consented && iv.mine,
  };
}

const T = {
  da: {
    expired: "Udløbet",
    mailFailed: "Mailen kunne ikke sendes.",
    resend: "Send igen",
    copyLink: "Kopiér invitationslink",
    remove: "Fjern",
    resent: (who: string) => `Invitationen er sendt igen til ${who}.`,
    copied: "Linket er kopieret. Det gælder i 72 timer, og tidligere links virker ikke længere.",
    copyFallback: "Kopiér linket herunder og send det selv. Det gælder i 72 timer.",
    rateLimited: "Vent lidt, før du prøver igen.",
    sendFailed: "Mailen kunne ikke sendes. Prøv igen om lidt, eller kopiér invitationslinket og send det selv.",
    removed: "Invitationen er fjernet.",
    failed: "Det lykkedes ikke. Prøv igen.",
    approvedMailFailed: "Du har godkendt, men mailen til personen kunne ikke sendes. Brug Send igen eller Kopiér invitationslink.",
    createdMailFailed: "Samtalen er oprettet, men mailen kunne ikke sendes. Åbn samtalen og tryk Send igen, eller kopiér invitationslinket og send det selv.",
    expiredSummary: (who: string) => `Invitationen er udløbet: ${who}`,
    failedSummary: (who: string) => `Mailen kom ikke frem: ${who}`,
    removeConfirmTitle: "Fjern invitationen?",
    removeConfirmBody: (who: string) => `${who} bliver fjernet fra listen. Du kan invitere igen senere.`,
    cancel: "Annuller",
    linkLabel: "Invitationslink",
  },
  en: {
    expired: "Expired",
    mailFailed: "The email could not be sent.",
    resend: "Send again",
    copyLink: "Copy invitation link",
    remove: "Remove",
    resent: (who: string) => `The invitation was sent again to ${who}.`,
    copied: "Link copied. It is valid for 72 hours, and earlier links no longer work.",
    copyFallback: "Copy the link below and send it yourself. It is valid for 72 hours.",
    rateLimited: "Please wait a moment before trying again.",
    sendFailed: "The email could not be sent. Try again shortly, or copy the invitation link and send it yourself.",
    removed: "The invitation was removed.",
    failed: "That didn't work. Try again.",
    approvedMailFailed: "You approved, but the email to the person could not be sent. Use Send again or Copy invitation link.",
    createdMailFailed: "The conversation was created, but the email could not be sent. Open the conversation and tap Send again, or copy the invitation link and send it yourself.",
    expiredSummary: (who: string) => `The invitation has expired: ${who}`,
    failedSummary: (who: string) => `The email did not arrive: ${who}`,
    removeConfirmTitle: "Remove the invitation?",
    removeConfirmBody: (who: string) => `${who} will be removed from the list. You can invite again later.`,
    cancel: "Cancel",
    linkLabel: "Invitation link",
  },
} as const;
export const invText = (lang: InvLang) => T[lang === "en" ? "en" : "da"];

/** Short, scannable info points on the "Invite person" sheet (most important first). Same facts as the sign-up notes, but split into bullets. */
export type InvitePoint = { lead?: string; text: string };
export function invitePoints(lang: InvLang): InvitePoint[] {
  return lang === "en"
    ? [
      { lead: "Important:", text: "Rolff can be used as a record. What you write and receive stays with the others in the conversation – even if you later delete your account." },
      { text: "You can delete your own copy, but you cannot require the others' copy to be deleted." },
      { text: "A new conversation is created for the two of you. The invitee only sees messages from after joining." },
      { text: "The others in the conversation see your email and can give you a private nickname that only they see. You always log in with your email." },
    ]
    : [
      { lead: "Vigtigt:", text: "Rolff kan bruges som dokumentation. Det, du skriver og modtager, bliver hos de andre i samtalen – også hvis du senere sletter din konto." },
      { text: "Du kan slette din egen kopi, men ikke kræve de andres slettet." },
      { text: "Der oprettes en ny samtale mellem jer to. Den inviterede ser kun beskeder fra efter, vedkommende er kommet med." },
      { text: "De andre i samtalen ser din e-mail og kan give dig et privat kaldenavn, som kun de ser. Du logger altid ind med din e-mail." },
    ];
}

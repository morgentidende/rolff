export type Lang = "da" | "en";
const da = {
  tagline: "Rolig, praktisk kommunikation mellem forældre – for børnenes skyld.",
  intro: "Rolff tjekker hver besked før afsendelse og stopper sårende formuleringer. Du bestemmer selv, hvornår du modtager nye beskeder.",
  ai: "AI-behandling: Din besked og op til 10 nyere beskeder sendes til en AI-tjeneste (testmiljø: Google Gemini, gratis niveau – kun opdigtede testbeskeder!).",
  aiAccept: "Jeg forstår og accepterer", email: "E-mail", password: "Adgangskode", name: "Visningsnavn",
  login: "Log ind", signup: "Opret konto", logout: "Log ud", authError: "Login mislykkedes. Tjek oplysningerne og prøv igen.",
  conversations: "Samtaler", newConv: "Ny samtale", title: "Titel (valgfri)", create: "Opret", join: "Tilslut med invitationskode", code: "Invitationskode",
  invite: "Inviter den anden forælder", inviteHint: "Del koden privat. Den udløber", copy: "Kopiér", invalidInvite: "Invitationen er ugyldig eller udløbet.",
  write: "Skriv en besked…", send: "Send", sending: "Tjekker…", accepted: "Rolff har accepteret beskeden.",
  blocked: "Beskeden blev ikke sendt. Den kan opfattes som sårende. Ret den og prøv igen.", flagged: "Markeret tekst",
  techError: "Teknisk fejl – beskeden er ikke sendt. Din tekst er gemt; prøv igen.", readOnly: "Du har kun læseadgang.", rateLimited: "For mange forsøg. Vent et øjeblik.",
  pending: (n: number) => `${n} ny(e) besked(er) venter til din modtagetid.`, receiveNow: "Modtag beskeder nu",
  windows: "Modtagetider", windowsOn: "Brug modtagetider", tz: "Tidszone", add: "Tilføj", remove: "Fjern", save: "Gem", saved: "Gemt",
  days: ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"], from: "Fra", to: "Til", back: "Tilbage", empty: "Ingen beskeder endnu.", you: "Dig",
  settings: "Indstillinger", lang: "Sprog", theme: "Tema", system: "System", light: "Lys", dark: "Mørk", members: "Medlemmer",
  testNotice: "TESTMILJØ – brug kun opdigtede beskeder og testkonti.",
};
const en: typeof da = {
  tagline: "Calm, practical communication between parents – for the children's sake.",
  intro: "Rolff checks every message before it is sent and stops hurtful wording. You decide when new messages reach you.",
  ai: "AI processing: Your message and up to 10 recent messages are sent to an AI service (test environment: Google Gemini free tier – synthetic test messages only!).",
  aiAccept: "I understand and accept", email: "Email", password: "Password", name: "Display name",
  login: "Log in", signup: "Create account", logout: "Log out", authError: "Sign-in failed. Check your details and try again.",
  conversations: "Conversations", newConv: "New conversation", title: "Title (optional)", create: "Create", join: "Join with invitation code", code: "Invitation code",
  invite: "Invite the other parent", inviteHint: "Share the code privately. It expires", copy: "Copy", invalidInvite: "The invitation is invalid or expired.",
  write: "Write a message…", send: "Send", sending: "Checking…", accepted: "Rolff accepted the message.",
  blocked: "The message was not sent. It may come across as hurtful. Edit it and try again.", flagged: "Flagged text",
  techError: "Technical error – the message was not sent. Your text is kept; please retry.", readOnly: "You have read-only access.", rateLimited: "Too many attempts. Please wait.",
  pending: (n: number) => `${n} new message(s) waiting for your receive time.`, receiveNow: "Receive messages now",
  windows: "Receive times", windowsOn: "Use receive times", tz: "Time zone", add: "Add", remove: "Remove", save: "Save", saved: "Saved",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], from: "From", to: "To", back: "Back", empty: "No messages yet.", you: "You",
  settings: "Settings", lang: "Language", theme: "Theme", system: "System", light: "Light", dark: "Dark", members: "Members",
  testNotice: "TEST ENVIRONMENT – use synthetic messages and test accounts only.",
};
export const strings = { da, en };
export const detectLang = (): Lang => (localStorage.getItem("lang") as Lang) || (navigator.language.startsWith("da") ? "da" : "en");

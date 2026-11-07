export function messageTime(date: string, lang: string) {
  return new Intl.DateTimeFormat(lang === "da" ? "da-DK" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(date));
}

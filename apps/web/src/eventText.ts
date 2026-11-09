// Pure text for conversation system notices (unit-tested with deno).
export type ConvEvent = { id: string; kind: string; actor_label: string; mine: boolean; created_at: string; new_label?: string | null };
export const eventText = (e: ConvEvent, da: boolean) => e.kind === "export"
  ? (e.mine ? (da ? "Du har lavet en udskrift af samtalen" : "You made a transcript of the conversation") : (da ? `${e.actor_label} har lavet en udskrift af samtalen` : `${e.actor_label} made a transcript of the conversation`))
  : e.kind === "email_changed" && e.new_label
  ? (e.mine ? (da ? `Du har skiftet e-mail til ${e.new_label}` : `You changed your e-mail to ${e.new_label}`) : (da ? `${e.actor_label} har skiftet e-mail til ${e.new_label}` : `${e.actor_label} changed their e-mail to ${e.new_label}`))
  : "";

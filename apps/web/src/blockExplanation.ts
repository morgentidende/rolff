// Luna's short "why" for a blocked message. The server already sanitizes; this is a second, client-side guard.
// Rendered as plain React text (never HTML). Anything unexpected -> "" so the standard text is shown instead.
export const EXPLANATION_CLIENT_MAX = 160;
export function cleanExplanation(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/<[^>]*>/g, " ").replace(/[\p{Cc}\p{Cf}<>]/gu, " ").replace(/\s+/g, " ").trim();
  if (!s || [...s].length > EXPLANATION_CLIENT_MAX) return "";
  return s;
}

// Rolff's "why" (concrete words, and earlier messages only when they influenced the block) for a blocked message. The server already sanitizes; this is a second, client-side guard.
// Rendered as plain React text (never HTML). Anything unexpected -> "" so the standard text is shown instead.
export const EXPLANATION_CLIENT_MAX = 360;
function stripUnusedContextLine(s: string): string {
  return s
    .replace(/\s*(?:Tidligere beskeder har ikke spillet en rolle|Tidligere beskeder spillede ingen rolle|Earlier messages played no role|Earlier messages did not play a role|Earlier messages have not played a role)\s*[.!]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function cleanExplanation(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = stripUnusedContextLine(raw.replace(/<[^>]*>/g, " ").replace(/[\p{Cc}\p{Cf}<>]/gu, " ").replace(/\s+/g, " ").trim());
  if (!s || [...s].length > EXPLANATION_CLIENT_MAX) return "";
  return s;
}

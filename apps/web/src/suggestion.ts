/** Apply an optional moderation rewrite into the composer. Never auto-sends. */
export function applySuggestion(current: string, suggestion: string | null | undefined): string {
  if (typeof suggestion !== "string") return current;
  const s = suggestion.trim();
  return s ? s : current;
}

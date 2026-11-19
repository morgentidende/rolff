/** Short context around the first flagged span, cut at word boundaries ("…" only where text was really left out),
 *  so the marked word is always visible and the line stays short. */
export function flaggedSnippet(text: string, spans: string[], before = 26, after = 40): { pre: string; hit: string; post: string } | null {
  for (const s of spans) {
    const i = s ? text.indexOf(s) : -1; if (i < 0) continue;
    let a = Math.max(0, i - before), b = Math.min(text.length, i + s.length + after);
    if (a > 0) { const sp = text.indexOf(" ", a); if (sp >= 0 && sp < i) a = sp + 1; }
    if (b < text.length) { const sp = text.lastIndexOf(" ", b); if (sp > i + s.length) b = sp; }
    return { pre: (a > 0 ? "…" : "") + text.slice(a, i), hit: s, post: text.slice(i + s.length, b) + (b < text.length ? "…" : "") };
  }
  return null;
}

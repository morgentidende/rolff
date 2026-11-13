// Sticky blocks: a text that was blocked once stays blocked for the same sender in the same conversation,
// even if a later model call (non-deterministic) would allow or ask for clarification.
import type { ModerationResult, ReasonCode } from "./moderation.ts";
import { REASON_CODES } from "./moderation.ts";

/** Normalization so trivial variations (case, spacing, punctuation, emoji-free width forms) hit the same key. */
export function normalizeForSticky(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("da").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function stickyHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sticky-v1:" + normalizeForSticky(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A remembered block always wins over a fresh allow/clarify. A fresh block is returned unchanged (keeps its suggestion). */
export function applySticky<T extends ModerationResult>(res: T, remembered: unknown): T | (ModerationResult & { sticky: true }) {
  if (res.decision === "block") return res;
  if (typeof remembered !== "string" || !(REASON_CODES as readonly string[]).includes(remembered) || remembered === "none" || remembered === "unclear_meaning") return res;
  return { decision: "block", reason_code: remembered as ReasonCode, spans: [], suggestion: "", explanation: "", sticky: true };
}

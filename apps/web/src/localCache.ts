// Pure helpers for the encrypted local message cache (no DOM). Deno-testable.
export const CACHE_LIMIT = 100;
export type Retention = "1y" | "5y" | "unlimited";
export type CacheEnvelope = { v: 1; retention: Retention; messages: unknown[] };

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function retentionMs(retention: string): number {
  if (retention === "unlimited") return Infinity;
  if (retention === "5y") return 5 * YEAR_MS;
  if (retention === "1y") return YEAR_MS;
  return Infinity; // default and unknown values: keep (messages are kept until the user deletes them)
}

export function withinRetention<T extends { created_at?: string }>(messages: T[], retention: string, now = Date.now()): T[] {
  const limit = retentionMs(retention);
  if (!Number.isFinite(limit)) return messages;
  return messages.filter((m) => {
    const t = Date.parse(String(m?.created_at ?? ""));
    return Number.isFinite(t) && t >= now - limit;
  });
}

/** Oldest first, then the newest CACHE_LIMIT (or fewer) so a chat can open at the bottom. */
export function newestKept<T extends { created_at?: string }>(messages: T[], limit = CACHE_LIMIT): T[] {
  const sorted = [...messages].sort((a, b) => Date.parse(String(a?.created_at ?? "")) - Date.parse(String(b?.created_at ?? "")));
  return sorted.slice(-limit);
}

export function isRetention(v: unknown): v is Retention {
  return v === "1y" || v === "5y" || v === "unlimited";
}

/** Accept the current envelope or a legacy bare array (no limit: nothing is dropped without the user's explicit choice). */
export function normalizeCached(value: unknown, now = Date.now()): { retention: Retention; messages: { created_at?: string }[] } {
  let retention: Retention = "unlimited";
  let messages: { created_at?: string }[] = [];
  if (Array.isArray(value)) messages = value;
  else if (value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)) {
    const r = (value as { retention?: unknown }).retention;
    retention = isRetention(r) ? r : "unlimited";
    messages = (value as { messages: { created_at?: string }[] }).messages;
  }
  return { retention, messages: newestKept(withinRetention(messages, retention, now)) };
}

export function wrapCache(messages: unknown[], retention: Retention = "unlimited", now = Date.now()): CacheEnvelope {
  const kept = newestKept(withinRetention(messages as { created_at?: string }[], retention, now));
  return { v: 1, retention, messages: kept };
}

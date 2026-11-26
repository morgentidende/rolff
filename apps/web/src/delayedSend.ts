/** Server-side delay applied when "Forsinkede beskeder" is on. */
export const DELAYED_SEND_SECONDS = 30;

/** Milliseconds left in the undo window, or null if the message is not pending. */
export function pendingRemainingMs(deliverAfter: string | null | undefined, now = Date.now()): number | null {
  if (!deliverAfter) return null;
  const t = Date.parse(deliverAfter);
  if (!Number.isFinite(t)) return null;
  const left = t - now;
  return left > 0 ? left : null;
}

export function isPendingSend(deliverAfter: string | null | undefined, now = Date.now()): boolean {
  return pendingRemainingMs(deliverAfter, now) != null;
}

/** A delayed message the sender has paused (Ret). It must not look like a sent bubble. */
export function isHeldMessage(m: { mine?: boolean; held?: boolean } | null | undefined): boolean {
  return !!m && !!m.mine && !!m.held;
}

/** Visible countdown whole seconds, between 1 and the full delay (a slightly stale clock never shows 31). */
export function pendingSeconds(deliverAfter: string | null | undefined, now = Date.now()): number | null {
  const ms = pendingRemainingMs(deliverAfter, now);
  if (ms == null) return null;
  return Math.min(DELAYED_SEND_SECONDS, Math.max(1, Math.ceil(ms / 1000)));
}

export function countdownAria(lang: "da" | "en", sec: number): string {
  return lang === "da" ? `Send nu (${sec} s)` : `Send now (${sec} s)`;
}

export function soonestPending<T extends { deliver_after?: string | null }>(msgs: T[], now = Date.now()): T | null {
  let best: T | null = null;
  let bestAt = Infinity;
  for (const m of msgs) {
    const ms = pendingRemainingMs(m.deliver_after, now);
    if (ms == null) continue;
    const at = now + ms;
    if (at < bestAt) { best = m; bestAt = at; }
  }
  return best;
}

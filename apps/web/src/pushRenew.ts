/** When to silently renew this device's push registration (web or native).
 *  The 90-day server expiry stays as cleanup for unused devices. Renewal is
 *  only for a binding that already belongs to the signed-in account. */
export const RENEW_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;
export const RENEW_MIN_GAP_MS = 24 * 60 * 60 * 1000;
export const RENEW_RETRY_GAP_MS = 5 * 60 * 1000;

export type RenewMemory = {
  /** Last observed push endpoint or native token (for change detection). */
  endpoint: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
};

export type RenewInput = {
  expiresAt: number;
  currentEndpoint: string;
  lastEndpoint: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  now: number;
};

/** Pure decision: renew on endpoint/token change, or when expiry is within 30
 *  days and the last successful renew is at least 24 h ago. Failed attempts
 *  may retry after 5 minutes. A first run with a far-off expiry only records
 *  the current endpoint — it does not renew every existing device on upgrade. */
export function shouldRenew(i: RenewInput): boolean {
  if (!i.currentEndpoint || !Number.isFinite(i.expiresAt)) return false;
  if (i.lastFailureAt != null && i.now - i.lastFailureAt < RENEW_RETRY_GAP_MS) return false;
  if (i.lastEndpoint && i.lastEndpoint !== i.currentEndpoint) return true;
  if (i.expiresAt - i.now > RENEW_WITHIN_MS) return false;
  if (i.lastSuccessAt != null && i.now - i.lastSuccessAt < RENEW_MIN_GAP_MS) return false;
  return true;
}

const STORE_KEY = "rolff:push-renew:v1";

export function memoryStore(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null): {
  read(owner: string): RenewMemory | null;
  write(owner: string, mem: RenewMemory): void;
} {
  const empty = (): Record<string, RenewMemory> => ({});
  const load = (): Record<string, RenewMemory> => {
    if (!storage) return empty();
    try { const raw = storage.getItem(STORE_KEY); return raw ? JSON.parse(raw) as Record<string, RenewMemory> : empty(); } catch { return empty(); }
  };
  return {
    read(owner) { try { return load()[owner] ?? null; } catch { return null; } },
    write(owner, mem) {
      if (!storage) return;
      try { const all = load(); all[owner] = mem; storage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* private mode */ }
    },
  };
}

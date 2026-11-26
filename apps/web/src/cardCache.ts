/**
 * Cards open at once with their final size: the data a card needs is fetched ahead (when the chat or a menu opens) and
 * the last known values are kept here, per signed-in user, in memory only (never in storage). A card shows them
 * instantly and refreshes in the background; while it has nothing yet it shows a full-size skeleton (CardSkeleton).
 * Saving stays fail-strict: cards only save on top of a fresh server read, never on top of a cached value.
 */
const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
let owner: string | null = null;

/** Call on every sign-in / sign-out / account switch: nothing cached ever crosses accounts. */
export function setCardCacheOwner(uid: string | null): void {
  if (uid === owner) return;
  store.clear(); inflight.clear(); owner = uid;
}
export function clearCardCache(): void { store.clear(); inflight.clear(); }
export function peekCard<T>(key: string): T | undefined { return store.get(key) as T | undefined; }
export function putCard<T>(key: string, value: T): T { store.set(key, value); return value; }
/** Starts (or joins) a background fetch; the result is cached. Never throws to the caller of prefetch. */
export function fetchCard<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const me = owner;
  const p = load().then((v) => { if (owner === me) store.set(key, v); return v; }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
export function prefetchCard<T>(key: string, load: () => Promise<T>): void { fetchCard(key, load).catch(() => { /* the card shows its own error */ }); }

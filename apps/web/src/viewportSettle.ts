/**
 * Android: switching to another app and back makes the browser fire a burst of resize / visualViewport
 * events with transient sizes (URL bar, IME and system bars re-appearing) before the real size settles.
 * Layout code that reacted to every one of them made the open card and the chat column jump for a frame.
 * `afterSettle` wraps such a handler: while the page is hidden, or for SETTLE_MS after it became visible /
 * regained focus, calls are coalesced into ONE call after the burst (handlers read live values then), so a
 * resume that ends at the old size changes nothing and a real change (e.g. keyboard) is applied once.
 */
export const SETTLE_MS = 350;
let quietUntil = 0, installed = false;
const arm = () => { quietUntil = Date.now() + SETTLE_MS; };
function install() {
  if (installed || typeof document === "undefined") return; installed = true;
  document.addEventListener("visibilitychange", arm);
  window.addEventListener("pageshow", arm); window.addEventListener("focus", arm); window.addEventListener("blur", arm);
}
export const isResuming = (): boolean => typeof document !== "undefined" && (document.visibilityState === "hidden" || Date.now() < quietUntil);

export function afterSettle<A extends unknown[]>(fn: (...a: A) => void): ((...a: A) => void) & { cancel(): void } {
  install();
  let t = 0;
  const wrapped = ((...a: A) => {
    if (!isResuming()) { fn(...a); return; }
    window.clearTimeout(t);
    t = window.setTimeout(() => { if (isResuming()) wrapped(...a); else fn(...a); }, Math.max(40, quietUntil - Date.now() + 30));
  }) as ((...a: A) => void) & { cancel(): void };
  wrapped.cancel = () => window.clearTimeout(t);
  return wrapped;
}

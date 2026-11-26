/**
 * WhatsApp-like page transitions between the conversation list (Home) and a chat.
 *
 *  - Opening a chat from the list: the chat slides in from the right over the list, which drifts a little to the left.
 *  - Back (← button, Android Back / back gesture): the chat slides out to the right and the list slides in from the left.
 *
 * Only one page is ever rendered (no double render, no hidden second React tree). Just before the switch the old page's
 * DOM is copied into an inert, aria-hidden, non-tappable layer (like the card close in modalLayer.ts exitGhost); after
 * React has committed the new page — in a layout effect, before the first paint — the new page and the copy are moved
 * with GPU transforms only (Web Animations, no classes or styles written to React-owned nodes, so nothing re-renders and
 * nothing reflows), and the copy is removed. Deep links and notifications that open a chat switch without animation.
 * prefers-reduced-motion, a missing Element.animate and jsdom (motionConfig) switch instantly as before.
 *
 * Smoothness (Android): every keyframe animates transform and opacity only, so Chrome runs the whole slide on the
 * compositor thread. An earlier version also animated box-shadow/background-color on the page, which made Chrome
 * run the slide on the main thread, where the chat's first message render and the list refresh froze it for
 * 100–150 ms ("small jerks"). The edge shadow and the opaque backdrop now live on a separate, static "sheet" layer
 * that only moves. Data that arrives during the slide is committed after it (whenPageSettled), so React does not
 * re-render and re-layout the pages mid-slide.
 */
import { motionConfig, reducedMotion, sanitize } from "./modalLayer";

export const PAGE_MS = 280;
export const PAGE_EASE = "cubic-bezier(.4,0,.2,1)"; // ease-in-out
export type PageDir = "forward" | "back";
export type PendingPage = { dir: PageDir; ghost: HTMLElement; clone: HTMLElement; scrolled: [number, number][] };

let running: { ghost: HTMLElement; layers: HTMLElement[]; anims: Animation[] } | null = null;
let settled: (() => void)[] = [];
function flushSettled() { const w = settled; settled = []; for (const f of w) f(); }
function stop() {
  if (running) { for (const a of running.anims) { try { a.cancel(); } catch { /* gone */ } } running.ghost.remove(); running.layers.forEach((l) => l.remove()); running = null; }
  flushSettled();
}

/**
 * Resolves when no page slide is running (at once when none is). Use it before committing data that arrived
 * during a slide, so the new page is not re-rendered and re-laid-out while it moves.
 */
export function whenPageSettled(): Promise<void> {
  if (!running) return Promise.resolve();
  return new Promise((r) => settled.push(r));
}

function enabled(wrap: HTMLElement | null): wrap is HTMLElement {
  return !!wrap && motionConfig.enabled && !reducedMotion() && typeof wrap.animate === "function";
}

/** Step 1, before the state change: copy what is on screen now. Returns null when the switch should be instant. */
export function preparePage(dir: PageDir, wrap: HTMLElement | null): PendingPage | null {
  stop();
  if (!enabled(wrap)) return null;
  const scrolled: [number, number][] = [];
  [wrap, ...Array.from(wrap.querySelectorAll<HTMLElement>("*"))].forEach((n, i) => { if (n.scrollTop > 0) scrolled.push([i, n.scrollTop]); });
  const clone = wrap.cloneNode(true) as HTMLElement;
  // Never carry open cards, menus or close-animation copies into the page copy.
  clone.querySelectorAll(".overlay,dialog,.menu,.menu-scrim,.toast,[data-ghost]").forEach((n) => n.remove());
  sanitize(clone);
  const ghost = document.createElement("div");
  ghost.className = `page-ghost page-ghost-${dir}`;
  sanitize(ghost);
  // Same visual position as the page had (the list scrolls the window; the copy is fixed).
  const y = window.scrollY || 0;
  if (y) clone.style.transform = `translateY(${-y}px)`;
  ghost.appendChild(clone);
  return { dir, ghost, clone, scrolled };
}

/** Step 2, in a layout effect right after React committed the new page (before paint): play the slide. */
export function playPage(p: PendingPage | null, wrap: HTMLElement | null): void {
  if (!p || !enabled(wrap)) return;
  document.body.appendChild(p.ghost);
  if (p.scrolled.length) { const all = [p.clone, ...Array.from(p.clone.querySelectorAll<HTMLElement>("*"))]; for (const [i, t] of p.scrolled) if (all[i]) all[i].scrollTop = t; }
  const o: KeyframeAnimationOptions = { duration: PAGE_MS, easing: PAGE_EASE };
  const anims: Animation[] = [], layers: HTMLElement[] = [];
  if (p.dir === "forward") {
    // New chat on top, sliding in from the right; the list copy underneath drifts left and dims a little.
    // The sheet is an opaque, shadowed backdrop that moves with the chat (static paint, so only its transform changes).
    const sheet = document.createElement("div");
    sheet.className = "page-sheet";
    sanitize(sheet);
    document.body.appendChild(sheet); layers.push(sheet);
    const move = [{ transform: "translate3d(100%,0,0)" }, { transform: "translate3d(0,0,0)" }];
    anims.push(wrap.animate(move, o));
    anims.push(sheet.animate(move, { ...o, fill: "forwards" }));
    anims.push(p.ghost.animate([{ transform: "translate3d(0,0,0)", opacity: 1 }, { transform: "translate3d(-25%,0,0)", opacity: .6 }], { ...o, fill: "forwards" }));
  } else {
    // Chat copy on top (with a static edge shadow), sliding out to the right; the list slides in from the left underneath.
    anims.push(p.ghost.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(100%,0,0)" }], { ...o, fill: "forwards" }));
    anims.push(wrap.animate([{ transform: "translate3d(-25%,0,0)", opacity: .6 }, { transform: "translate3d(0,0,0)", opacity: 1 }], o));
  }
  const me = { ghost: p.ghost, layers, anims };
  running = me;
  const done = () => { if (running === me) stop(); };
  anims[0].finished.then(done, done);
  setTimeout(done, PAGE_MS + 150); // safety net, e.g. when the tab is hidden mid-way
}

/** Test hook: whether a page copy is on screen. */
export function pageGhostActive(): boolean { return !!running; }

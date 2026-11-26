import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { afterSettle } from "./viewportSettle";

/**
 * Shared behaviour for every modal surface (sheets, confirm/mute dialogs, native <dialog>s,
 * dropdown menus and the long-press message menu):
 *  - the background becomes inactive (`inert`), so nothing behind a card can be tapped, focused
 *    or read by a screen reader while it is open,
 *  - background scroll is locked,
 *  - Tab stays inside the card,
 *  - a tap on the backdrop only closes the card: it is acted on at click time (so the click
 *    never falls through to what is behind) and trailing ghost taps are swallowed briefly.
 * Visual dim + blur lives in styles.css (`.overlay`, `.message-overlay`, `.menu-scrim`, ::backdrop).
 */

/** Elements that must stay live while a modal is open: toasts (screen-reader announcements) and backdrops. */
const EXEMPT = "script,style,link,template,[data-modal-exempt]";
const inertState = new WeakMap<Element, { n: number; was: boolean }>();

/** Marks everything outside `layer` inert. Reference counted, so stacked layers (sheet → confirm) nest. */
function inertOutside(layer: Element): () => void {
  const marked: Element[] = [];
  let node: Element | null = layer;
  while (node && node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || sib.matches(EXEMPT)) continue;
      const st = inertState.get(sib);
      if (st) st.n++; else { inertState.set(sib, { n: 1, was: sib.hasAttribute("inert") }); sib.setAttribute("inert", ""); }
      marked.push(sib);
    }
    node = parent;
  }
  return () => {
    for (const sib of marked) {
      const st = inertState.get(sib); if (!st) continue;
      if (--st.n > 0) continue;
      inertState.delete(sib);
      if (!st.was) sib.removeAttribute("inert");
    }
  };
}

const layers: HTMLElement[] = [];
let locks = 0;
let saved: { pr: string } | null = null;
function lockScroll(): () => void {
  const root = document.documentElement, body = document.body;
  if (locks++ === 0) {
    // Keep the layout stable on desktop browsers where the scrollbar disappears.
    const gutter = Math.max(0, window.innerWidth - root.clientWidth);
    saved = { pr: body.style.paddingRight };
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    root.classList.add("modal-open");
  }
  return () => {
    if (--locks > 0) return;
    locks = 0; root.classList.remove("modal-open");
    if (saved) { body.style.paddingRight = saved.pr; saved = null; }
  };
}

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";
function visible(x: HTMLElement): boolean { const cs = getComputedStyle(x); return cs.display !== "none" && cs.visibility !== "hidden"; }
function trapTab(el: HTMLElement, e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const f = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(x => !x.closest("[inert],[hidden]") && visible(x));
  if (!f.length) { e.preventDefault(); el.focus({ preventScroll: true }); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!el.contains(a) || (e.shiftKey && (a === first || a === el))) { e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true }); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
}

/**
 * Makes `ref`'s element a modal layer while `active`. `native` skips the Tab trap and inert marking
 * for `<dialog>`s opened with showModal(), which the browser already makes modal.
 */
export function useModalLayer(active: boolean, ref: React.RefObject<HTMLElement | null>, opts: { native?: boolean } = {}): void {
  const native = !!opts.native;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const releaseScroll = lockScroll();
    const releaseInert = native ? () => {} : inertOutside(el);
    // Document level, after the card's own handlers: a card that traps Tab itself (confirm, mute) wins.
    const onKey = (e: KeyboardEvent) => { if (!native && !e.defaultPrevented && layers[layers.length - 1] === el) trapTab(el, e); };
    layers.push(el); document.addEventListener("keydown", onKey);
    const parent = el.parentNode;
    return () => {
      document.removeEventListener("keydown", onKey); layers.splice(layers.indexOf(el), 1); releaseInert(); releaseScroll();
      // WhatsApp-like close: a non-interactive copy fades and shrinks out where the card was (see exitGhost).
      exitGhost(el, el.parentNode ?? parent);
    };
  }, [active, native, ref]);
}

// ---- open / close motion ------------------------------------------------------------------------

/**
 * Cards, sheets, dialogs and menus open with a short fade + scale-up (CSS, styles.css "Card motion") and close with a
 * fade + slight scale-down. React unmounts a closed card at once, so the close animation plays on a copy: an inert,
 * aria-hidden, non-tappable clone put where the card was, removed after EXIT_MS. The real card is already gone, so
 * focus, outside-tap, Back and the page behind behave exactly as before; nothing moves (the copy is fixed/absolute
 * like the card itself). Off with prefers-reduced-motion, and in jsdom (tests opt in via motionConfig).
 */
export const EXIT_MS = 200;
export const motionConfig = { enabled: typeof navigator !== "undefined" && !/jsdom/i.test(navigator.userAgent) };
const GHOSTABLE = ".overlay,.message-overlay,.menu,dialog";
export function reducedMotion(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
export function sanitize(root: HTMLElement) {
  for (const n of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    for (const a of ["id", "name", "for", "autofocus", "tabindex", "aria-modal", "aria-labelledby", "aria-describedby", "aria-controls"]) n.removeAttribute(a);
    if (n.getAttribute("role") === "dialog" || n.getAttribute("role") === "alertdialog" || n.getAttribute("role") === "menu") n.removeAttribute("role");
  }
  root.setAttribute("data-ghost", ""); root.setAttribute("data-modal-exempt", ""); root.setAttribute("aria-hidden", "true"); root.setAttribute("inert", "");
}
/** Plays the close animation on a copy of `el` (see above). Returns the copy, or null when no animation is played. */
export function exitGhost(el: HTMLElement, parent: Node | null): HTMLElement | null {
  if (!motionConfig.enabled || reducedMotion() || typeof document === "undefined") return null;
  if (!el.matches(GHOSTABLE) || !parent) return null;
  const isDialog = el.tagName === "DIALOG";
  const rect = el.isConnected ? el.getBoundingClientRect() : null;
  if (isDialog && (!rect || rect.width === 0 || rect.height === 0)) return null;
  // Keep what the user was looking at: scroll positions are lost on a copy.
  const scrolled: [number, number][] = [];
  if (el.isConnected) [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))].forEach((n, i) => { if (n.scrollTop > 0) scrolled.push([i, n.scrollTop]); });
  const clone = el.cloneNode(true) as HTMLElement;
  if (!(clone.textContent ?? "").trim()) return null;
  sanitize(clone);
  let scrim: HTMLElement | null = null;
  if (isDialog || el.classList.contains("menu")) {
    // A native dialog's ::backdrop and the menu's scrim disappear with them: fade a matching scrim out too.
    scrim = document.createElement("div"); scrim.className = "menu-scrim ghost-scrim"; sanitize(scrim);
  }
  if (isDialog && rect) {
    clone.removeAttribute("open"); clone.setAttribute("open", "");
    Object.assign(clone.style, { position: "fixed", inset: "auto", top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, maxHeight: "none", margin: "0", transform: "none", zIndex: "1001" });
  }
  queueMicrotask(() => {
    const host = isDialog ? document.body : parent;
    if (!(host as Node).isConnected) return;
    if (scrim) document.body.appendChild(scrim);
    host.appendChild(clone);
    if (scrolled.length) { const all = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]; for (const [i, t] of scrolled) if (all[i]) all[i].scrollTop = t; }
    setTimeout(() => { clone.remove(); scrim?.remove(); }, EXIT_MS + 40);
  });
  return clone;
}

// ---- backdrop dismissal -------------------------------------------------------------------------

const GHOST_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"] as const;
const MODAL_SELECTOR = "[aria-modal=true],dialog[open],.overlay,.message-overlay,.menu-scrim";
/** Real taps only: synthetic events (tests, programmatic clicks) are never swallowed unless a test turns this off. */
export const ghostConfig = { onlyTrusted: true };
let ghostUntil = 0;
let ghostInstalled = false;
function ghostSwallow(e: Event) {
  if (Date.now() > ghostUntil) { uninstallGhost(); return; }
  if (ghostConfig.onlyTrusted && !e.isTrusted) return;
  const t = e.target as Element | null;
  if (t && typeof t.closest === "function" && t.closest(MODAL_SELECTOR)) return; // a newly opened card is not "behind"
  e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
}
function uninstallGhost() {
  if (!ghostInstalled) return; ghostInstalled = false;
  for (const n of GHOST_EVENTS) window.removeEventListener(n, ghostSwallow, true);
}
/** After a backdrop tap closed a card, swallow the trailing touch/mouse events (ghost click) for a moment. */
export function swallowGhostTaps(ms = 350): void {
  ghostUntil = Date.now() + ms;
  if (!ghostInstalled) { ghostInstalled = true; for (const n of GHOST_EVENTS) window.addEventListener(n, ghostSwallow, true); }
  window.setTimeout(() => { if (Date.now() >= ghostUntil) uninstallGhost(); }, ms + 20);
}

/**
 * Props for a full-screen backdrop element. A tap dismisses only when the press STARTED and ENDED
 * on the backdrop, and only at click time (never on pointerdown, which used to remove the backdrop
 * before the click and let it land on the chat behind). `blocked()` lets a caller veto (e.g. the
 * message menu's "armed" state right after a long-press).
 */
export function useBackdropDismiss(close: () => void, blocked?: () => boolean, opts?: { outsideBox?: boolean }) {
  const down = useRef(false), latest = useRef(close), veto = useRef(blocked), box = useRef(!!opts?.outsideBox);
  latest.current = close; veto.current = blocked; box.current = !!opts?.outsideBox;
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => { down.current = e.target === e.currentTarget; }, []);
  const onPointerCancel = useCallback(() => { down.current = false; }, []);
  const onClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    const started = down.current; down.current = false;
    e.preventDefault(); e.stopPropagation(); // the tap ends here
    if (!started || veto.current?.()) return;
    // Native <dialog>: the dialog element IS the card, so a click on its padding has
    // target === currentTarget. Only a click outside the card box (the ::backdrop) dismisses.
    if (box.current) {
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
    }
    swallowGhostTaps(); latest.current();
  }, []);
  return { onPointerDown, onPointerCancel, onClick };
}

// ---- placement inside a conversation --------------------------------------------------------------

/** Fallback header height (px) when the header exists but has no layout (jsdom). */
const HEADER_FALLBACK = 56;
/** Bottom edge (px from the top of the viewport) of the open conversation's header, or null on the front page. */
export function chatHeaderBottom(): number | null {
  const h = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".topbar.chat:not([data-ghost] *)");
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return r.height > 0 ? Math.max(0, Math.round(r.bottom)) : HEADER_FALLBACK;
}
/** Gap (px) between the chat header and every card opened inside a conversation. One value for all cards. */
export const CHAT_CARD_GAP = 8;
/** Smallest height (px) a card keeps on a short screen (keyboard open), so it can never fold into a strip. */
export const CARD_MIN_HEIGHT = 180;
/** Height (px) of the visible viewport: visualViewport shrinks when the mobile keyboard opens, innerHeight does not on Android. */
export function visibleHeight(): number {
  if (typeof window === "undefined") return 0;
  return Math.round(window.visualViewport?.height ?? window.innerHeight);
}
/**
 * The ONE top offset for cards opened inside a conversation: directly under the chat header (+ CHAT_CARD_GAP).
 * On a very short visible viewport (keyboard open) the card moves up just enough to keep CARD_MIN_HEIGHT above
 * the keyboard. Null on the front page (cards keep their usual place).
 */
export function chatCardTop(vh: number = visibleHeight()): number | null {
  const b = chatHeaderBottom();
  if (b === null) return null;
  const want = b + CHAT_CARD_GAP;
  if (!(vh > 0)) return want;
  return Math.max(8, Math.min(want, vh - CARD_MIN_HEIGHT - 12));
}
/** Inline style for a native <dialog> card inside a conversation: same top as every other in-chat card, never taller
 *  than the visible area above the keyboard, never collapsed (the dialog scrolls inside). */
export function chatDialogStyle(top: number | null): React.CSSProperties | undefined {
  if (top === null) return undefined;
  return { top, maxHeight: `max(${CARD_MIN_HEIGHT}px, calc(var(--vv-h, 100dvh) - ${top + 12}px))` };
}
/**
 * Cards opened from inside a conversation sit directly under the chat header (anchored top, scrollable,
 * limited by the visible height above the keyboard) instead of at the bottom of the screen. Returns the
 * shared card top (chatCardTop) for the overlay's top padding / dialog top, or null on the front page.
 */
export function useUnderChatHeader(): number | null {
  const [top, setTop] = useState<number | null>(() => chatCardTop());
  useEffect(() => {
    const update = afterSettle(() => setTop(chatCardTop()));
    window.addEventListener("resize", update); window.visualViewport?.addEventListener("resize", update);
    return () => { update.cancel(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, []);
  return top;
}

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
    return () => { document.removeEventListener("keydown", onKey); layers.splice(layers.indexOf(el), 1); releaseInert(); releaseScroll(); };
  }, [active, native, ref]);
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
  const h = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".topbar.chat");
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return r.height > 0 ? Math.max(0, Math.round(r.bottom)) : HEADER_FALLBACK;
}
/**
 * Cards opened from inside a conversation sit directly under the chat header (anchored top, scrollable,
 * limited by the visible height above the keyboard) instead of at the bottom of the screen. Returns the
 * header's bottom edge for the overlay's top padding, or null on the front page (cards keep their place).
 */
export function useUnderChatHeader(): number | null {
  const [top, setTop] = useState<number | null>(() => chatHeaderBottom());
  useEffect(() => {
    const update = afterSettle(() => setTop(chatHeaderBottom()));
    window.addEventListener("resize", update); window.visualViewport?.addEventListener("resize", update);
    return () => { update.cancel(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, []);
  return top;
}

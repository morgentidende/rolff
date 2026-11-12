import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

export type AnchorRect = { top: number; bottom: number; left: number; right: number };
/** The visible part of the page, in the same coordinates as position:fixed. */
export type VisibleViewport = { top: number; left: number; width: number; height: number };
export type AnchoredPlacement = { top: number; left: number; maxHeight: number; maxWidth: number; placement: "below" | "above" };
export type AnchorOptions = { align: "start" | "end"; flip?: boolean; gap?: number; margin?: number; minVisible?: number };

/** visualViewport shrinks when the mobile keyboard opens; innerHeight does not on Android. */
export function visibleViewport(w: Window = window): VisibleViewport {
  const v = w.visualViewport;
  if (v && v.width > 0 && v.height > 0) return { top: v.offsetTop, left: v.offsetLeft, width: v.width, height: v.height };
  return { top: 0, left: 0, width: w.innerWidth, height: w.innerHeight };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/** Pure placement: directly below the anchor, flipped above when there is no
 * room below, always clamped inside the visible viewport with safe margins.
 * If neither side fits, the side with more room is used and maxHeight makes the
 * panel scroll internally. */
export function computeAnchoredPosition(anchor: AnchorRect, size: { width: number; height: number }, viewport: VisibleViewport, opts: AnchorOptions): AnchoredPlacement {
  const margin = opts.margin ?? 12, gap = opts.gap ?? 8;
  const vTop = viewport.top + margin, vBottom = viewport.top + viewport.height - margin;
  const vLeft = viewport.left + margin, vRight = viewport.left + viewport.width - margin;
  const usable = Math.max(0, vBottom - vTop);
  const h = Math.min(size.height, usable);
  const minVisible = Math.min(h, opts.minVisible ?? 160);
  const roomBelow = vBottom - (anchor.bottom + gap), roomAbove = (anchor.top - gap) - vTop;
  const flip = opts.flip ?? true;
  const placement: "below" | "above" = !flip || h <= roomBelow ? "below" : h <= roomAbove ? "above" : roomBelow >= roomAbove ? "below" : "above";
  let top: number, maxHeight: number;
  if (placement === "below") {
    top = Math.max(vTop, anchor.bottom + gap);
    if (vBottom - top < minVisible) top = vBottom - minVisible;
    maxHeight = vBottom - top;
  } else {
    let edge = Math.min(vBottom, anchor.top - gap);
    if (edge - vTop < minVisible) edge = vTop + minVisible;
    maxHeight = edge - vTop;
    top = edge - Math.min(h, maxHeight);
  }
  const maxWidth = Math.max(0, vRight - vLeft);
  const width = Math.min(size.width, maxWidth);
  const left = clamp(opts.align === "end" ? anchor.right - width : anchor.left, vLeft, vRight - width);
  return { top: Math.round(top), left: Math.round(left), maxHeight: Math.max(0, Math.floor(maxHeight)), maxWidth: Math.floor(maxWidth), placement };
}

/** Keeps a fixed panel anchored while the viewport changes (keyboard, rotation,
 * scroll or content growth). Returns null until measured. */
export function useAnchoredPlacement(open: boolean, getAnchor: () => AnchorRect | null, panel: RefObject<HTMLElement | null>, opts: AnchorOptions, key?: unknown) {
  const [pos, setPos] = useState<AnchoredPlacement | null>(null);
  const { align, flip, gap, margin, minVisible } = opts;
  const anchorFn = useRef(getAnchor); anchorFn.current = getAnchor;
  const update = useCallback(() => {
    const el = panel.current, anchor = anchorFn.current();
    if (!el || !anchor) return;
    const frame = el.offsetHeight - el.clientHeight;
    const next = computeAnchoredPosition(anchor, { width: el.offsetWidth, height: el.scrollHeight + Math.max(0, frame) }, visibleViewport(), { align, flip, gap, margin, minVisible });
    setPos(p => p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight && p.maxWidth === next.maxWidth && p.placement === next.placement ? p : next);
  }, [align, flip, gap, margin, minVisible]);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    update();
    const v = window.visualViewport;
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    v?.addEventListener("resize", update); v?.addEventListener("scroll", update);
    const ro = typeof ResizeObserver === "function" && panel.current ? new ResizeObserver(() => update()) : null;
    if (ro && panel.current) ro.observe(panel.current);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); v?.removeEventListener("resize", update); v?.removeEventListener("scroll", update); ro?.disconnect(); };
  }, [open, update, key]);
  return { pos, update };
}

export const rectOf = (el: Element | null | undefined): AnchorRect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

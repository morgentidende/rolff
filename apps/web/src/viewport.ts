/** App-wide keyboard/visible-viewport tracking for modals and sheets.
 *  On Android Chrome the layout viewport keeps its height when the keyboard opens; only
 *  `visualViewport` shrinks. Bottom sheets and dialogs are positioned with these CSS
 *  variables so they sit ABOVE the keyboard instead of underneath it:
 *   --vv-h       visible viewport height (px)
 *   --kbd-inset  part of the layout viewport covered at the bottom (keyboard), px
 *  and `data-keyboard` on <html> while the keyboard is (most likely) open. */
export function viewportVars(w: Pick<Window, "innerHeight" | "visualViewport">): { vh: number; inset: number } {
  const v = w.visualViewport;
  if (!v) return { vh: Math.round(w.innerHeight), inset: 0 };
  const vh = Math.round(v.height);
  const inset = Math.max(0, Math.round(w.innerHeight - (v.offsetTop + v.height)));
  return { vh, inset };
}

export function installViewportVars(w: Window = window): () => void {
  const root = w.document.documentElement;
  let full = w.innerHeight, width = w.innerWidth, raf = 0;
  const apply = () => {
    raf = 0;
    if (w.innerWidth !== width) { width = w.innerWidth; full = w.innerHeight; }
    full = Math.max(full, w.innerHeight);
    const { vh, inset } = viewportVars(w);
    root.style.setProperty("--vv-h", `${vh}px`);
    root.style.setProperty("--kbd-inset", `${inset}px`);
    const open = vh < full * 0.75, wasOpen = "keyboard" in root.dataset;
    if (open) root.dataset.keyboard = ""; else delete root.dataset.keyboard;
    // When the keyboard opens, the sheet/dialog shrinks to fit above it. Keep the field that
    // is being typed in visible inside the (now shorter) sheet.
    if (open && !wasOpen) {
      const a = w.document.activeElement as HTMLElement | null;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest("dialog, .overlay")) {
        setTimeout(() => a.scrollIntoView?.({ block: "nearest" }), 60);
      }
    }
  };
  const schedule = () => { if (!raf) raf = (w.requestAnimationFrame ?? ((f: FrameRequestCallback) => setTimeout(f, 0) as unknown as number))(apply); };
  apply();
  const v = w.visualViewport;
  v?.addEventListener("resize", schedule); v?.addEventListener("scroll", schedule); w.addEventListener("resize", schedule);
  return () => { v?.removeEventListener("resize", schedule); v?.removeEventListener("scroll", schedule); w.removeEventListener("resize", schedule); };
}

/** Moves focus to the field that blocks a submit and briefly highlights it, so a tap on an
 *  "incomplete" button is never silently ignored. The visible reason is rendered by the form
 *  (role="alert", linked with aria-describedby). */
export function focusField(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

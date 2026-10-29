// Helpers for building the sequencer's DOM: the shared ones and its own.

export { h, setText, svg } from "@a2f0/dnbm-synth/ui/dom";

/** Sets a class name only when it changed, so frequent updates stay cheap. */
export function setClass(element: Element, className: string): void {
  if (element.className !== className) element.className = className;
}

/**
 * Scrolls each of `containers`, innermost first, the least that shows `element`, as
 * `scrollIntoView` with "nearest" would, but no further: `scrollIntoView` would also
 * scroll the host page around the app.
 */
export function reveal(element: Element, ...containers: readonly Element[]): void {
  for (const container of containers) {
    const box = element.getBoundingClientRect();
    const view = container.getBoundingClientRect();
    const left = view.left + container.clientLeft;
    const top = view.top + container.clientTop;
    const right = left + container.clientWidth;
    const bottom = top + container.clientHeight;
    // Past the far edge, move to show the far edge, or the near edge if it doesn't fit.
    const x =
      box.left < left ? box.left - left : Math.max(0, Math.min(box.right - right, box.left - left));
    const y =
      box.top < top ? box.top - top : Math.max(0, Math.min(box.bottom - bottom, box.top - top));
    if (x !== 0 || y !== 0) container.scrollBy(x, y);
  }
}

/** True while the user is typing in a field, when single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

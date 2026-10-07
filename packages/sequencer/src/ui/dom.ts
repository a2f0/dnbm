// A small helper for building DOM trees.

type Attributes = Record<string, string | number | boolean | undefined>;

/**
 * Creates an element. `class` sets the class name and `text` the text content; other
 * attributes are set as given, true as an empty attribute and false or undefined not
 * at all.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === "class") element.className = String(value);
    else if (name === "text") element.textContent = String(value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  element.append(...children);
  return element;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  children: readonly Node[] = [],
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

/** Sets a class name only when it changed, so frequent updates stay cheap. */
export function setClass(element: Element, className: string): void {
  if (element.className !== className) element.className = className;
}

export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
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

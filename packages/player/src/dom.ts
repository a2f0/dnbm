// Small helpers for building the player's DOM.

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

/** A 16 by 16 icon drawn from one path, filled with the text colour. */
export function icon(path: string): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, "svg");
  element.setAttribute("viewBox", "0 0 16 16");
  element.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(SVG_NS, "path");
  shape.setAttribute("d", path);
  element.append(shape);
  return element;
}

export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

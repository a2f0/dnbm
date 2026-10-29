// Helpers for building the player's DOM: the shared ones and its own.

import { svg } from "@a2f0/dnbm-synth/ui/dom";

export { h, setText } from "@a2f0/dnbm-synth/ui/dom";

/** A 16 by 16 icon drawn from one path, filled with the text colour. */
export function icon(path: string): SVGSVGElement {
  return svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, [svg("path", { d: path })]);
}

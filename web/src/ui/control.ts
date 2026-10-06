// A knob or fader for one parameter. Drag up and down (Shift for fine control), scroll,
// or use the arrow keys; double-click resets it to its default. It is a slider to
// assistive technology.

import { type ParamSpec, quantize } from "../song/instruments";
import { h, setText, svg } from "./dom";
import { formatValue, fromUnit, toUnit } from "./values";

export interface ControlOptions {
  readonly spec: ParamSpec;
  readonly label?: string;
  readonly variant?: "knob" | "fader";
  /** Called as the value changes during a gesture. */
  readonly onChange: (value: number) => void;
  /** Called once a gesture ends, to close its undo step. */
  readonly onCommit?: () => void;
}

const DRAG_PIXELS = 160;
const SWEEP_DEGREES = 270;
const RADIUS = 13;

function polar(degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [16 + RADIUS * Math.cos(radians), 16 + RADIUS * Math.sin(radians)];
}

/** An SVG arc from one angle to another, measured clockwise from twelve o'clock. */
function arc(from: number, to: number): string {
  const [x1, y1] = polar(from);
  const [x2, y2] = polar(to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export class ParamControl {
  readonly element: HTMLElement;
  private value: number;
  private dragging = false;
  private readonly readout: HTMLElement;
  private readonly draw: () => void;

  constructor(private readonly options: ControlOptions) {
    const { spec, variant = "knob" } = options;
    const label = options.label ?? spec.label;
    this.value = spec.default;
    this.readout = h("span", { class: "control-value" });
    this.element = h(
      "div",
      {
        class: `control ${variant}`,
        role: "slider",
        tabindex: 0,
        "aria-label": label,
        "aria-valuemin": spec.min,
        "aria-valuemax": spec.max,
        "aria-orientation": "vertical",
        title: `${label}: drag or scroll, double-click to reset`,
      },
      [],
    );
    this.draw = variant === "knob" ? this.buildKnob(label) : this.buildFader(label);
    this.listen();
    this.draw();
  }

  private bipolar(): boolean {
    return (
      this.options.spec.min < 0 && this.options.spec.max > 0 && this.options.spec.unit !== "dB"
    );
  }

  private buildKnob(label: string): () => void {
    const start = -SWEEP_DEGREES / 2;
    const track = svg("path", { class: "knob-track", d: arc(start, -start) });
    const fill = svg("path", { class: "knob-fill" });
    const pointer = svg("line", { class: "knob-pointer", x1: 16, y1: 16, x2: 16, y2: 5 });
    this.element.append(
      svg("svg", { viewBox: "0 0 32 32", class: "knob-dial", "aria-hidden": "true" }, [
        track,
        fill,
        pointer,
      ]),
      h("span", { class: "control-label", text: label }),
      this.readout,
    );
    return () => {
      const unit = toUnit(this.options.spec, this.value);
      const angle = start + unit * SWEEP_DEGREES;
      const origin = this.bipolar() ? 0 : start;
      fill.setAttribute(
        "d",
        Math.abs(angle - origin) < 0.5 ? "" : arc(Math.min(origin, angle), Math.max(origin, angle)),
      );
      pointer.setAttribute("transform", `rotate(${angle.toFixed(1)} 16 16)`);
      this.label();
    };
  }

  private buildFader(label: string): () => void {
    const fill = h("div", { class: "fader-fill" });
    const thumb = h("div", { class: "fader-thumb" });
    this.element.append(
      h("div", { class: "fader-track", "aria-hidden": "true" }, [fill, thumb]),
      h("span", { class: "control-label visually-hidden", text: label }),
      this.readout,
    );
    return () => {
      const percent = `${(toUnit(this.options.spec, this.value) * 100).toFixed(1)}%`;
      fill.style.height = percent;
      thumb.style.bottom = percent;
      this.label();
    };
  }

  private label(): void {
    const text = formatValue(this.options.spec, this.value);
    setText(this.readout, text);
    this.element.setAttribute("aria-valuenow", String(this.value));
    this.element.setAttribute("aria-valuetext", text);
  }

  private change(value: number): void {
    const next = quantize(this.options.spec, value);
    if (next === this.value) return;
    this.value = next;
    this.draw();
    this.options.onChange(next);
  }

  private nudge(steps: number): void {
    const { spec } = this.options;
    if (spec.curve === "log") {
      this.change(fromUnit(spec, toUnit(spec, this.value) + steps / 100));
    } else {
      this.change(
        this.value +
          steps * spec.step * Math.max(1, Math.round((spec.max - spec.min) / spec.step / 100)),
      );
    }
  }

  private listen(): void {
    const { spec } = this.options;
    let startY = 0;
    let startUnit = 0;
    this.element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.element.focus();
      this.element.setPointerCapture(event.pointerId);
      this.dragging = true;
      startY = event.clientY;
      startUnit = toUnit(spec, this.value);
    });
    this.element.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const scale = event.shiftKey ? DRAG_PIXELS * 8 : DRAG_PIXELS;
      this.change(fromUnit(spec, startUnit + (startY - event.clientY) / scale));
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.options.onCommit?.();
    };
    this.element.addEventListener("pointerup", end);
    this.element.addEventListener("pointercancel", end);
    this.element.addEventListener("lostpointercapture", end);
    this.element.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.nudge(event.deltaY < 0 ? 1 : -1);
        this.options.onCommit?.();
      },
      { passive: false },
    );
    this.element.addEventListener("dblclick", () => {
      this.change(spec.default);
      this.options.onCommit?.();
    });
    this.element.addEventListener("keydown", (event) => {
      const steps: Record<string, number> = {
        ArrowUp: 1,
        ArrowRight: 1,
        ArrowDown: -1,
        ArrowLeft: -1,
        PageUp: 10,
        PageDown: -10,
      };
      if (event.key in steps) {
        event.preventDefault();
        this.nudge((steps[event.key] ?? 0) * (event.shiftKey ? 10 : 1));
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        this.change(event.key === "Home" ? spec.min : spec.max);
      } else {
        return;
      }
      this.options.onCommit?.();
    });
  }

  /** Shows a value from the song, unless the user is mid-drag. */
  set(value: number): void {
    if (this.dragging || value === this.value) return;
    this.value = value;
    this.draw();
  }
}

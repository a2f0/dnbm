// How parameter values read on screen.

import type { ParamSpec } from "../song/instruments";

export function formatValue(spec: ParamSpec, value: number): string {
  switch (spec.unit) {
    case "Hz":
      if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
      if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
      return `${Math.round(value)}`;
    case "s":
      return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
    case "dB":
      return value <= spec.min ? "-inf" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
    case "ct":
      return `${value.toFixed(1)}ct`;
    case "st":
      return `${value}st`;
    case "×":
      return `${value.toFixed(2)}×`;
    case "steps":
      return `${value}/16`;
    default:
      break;
  }
  if (spec.key === "pan") {
    if (value === 0) return "C";
    return `${value < 0 ? "L" : "R"}${Math.round(Math.abs(value) * 100)}`;
  }
  return value.toFixed(2);
}

/** A value's position along its control, from 0 to 1. */
export function toUnit(spec: ParamSpec, value: number): number {
  const unit =
    spec.curve === "log"
      ? Math.log(value / spec.min) / Math.log(spec.max / spec.min)
      : (value - spec.min) / (spec.max - spec.min);
  return Math.min(1, Math.max(0, unit));
}

export function fromUnit(spec: ParamSpec, unit: number): number {
  const u = Math.min(1, Math.max(0, unit));
  return spec.curve === "log"
    ? spec.min * (spec.max / spec.min) ** u
    : spec.min + u * (spec.max - spec.min);
}

// The instruments and every adjustable number in a song: ranges, defaults, and the
// step each value rounds to. The UI, the song format, the JSON schema and the compiled
// song all read these tables. The engine lists its own parameter order
// (engine/src/instruments/mod.rs); test/engine.test.ts keeps the two equal.

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  /** Values round to a multiple of this, so saved songs never carry float noise. */
  readonly step: number;
  readonly unit?: "Hz" | "s" | "dB" | "ct" | "st" | "×" | "steps";
  /** Knobs sweep logarithmic parameters evenly by ratio rather than difference. */
  readonly curve?: "log";
}

export const INSTRUMENT_KINDS = [
  "kick",
  "snare",
  "hat",
  "perc",
  "sub",
  "reese",
  "pluck",
  "pad",
] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

export interface InstrumentSpec {
  readonly kind: InstrumentKind;
  readonly label: string;
  readonly description: string;
  /** Melodic instruments play notes; the rest play hits. */
  readonly melodic: boolean;
  /** The note a new melodic step starts on. */
  readonly defaultNote: number;
  readonly params: readonly ParamSpec[];
}

const hz = (key: string, label: string, min: number, max: number, value: number): ParamSpec => ({
  key,
  label,
  min,
  max,
  default: value,
  step: 1,
  unit: "Hz",
  curve: "log",
});

const seconds = (
  key: string,
  label: string,
  min: number,
  max: number,
  value: number,
): ParamSpec => ({
  key,
  label,
  min,
  max,
  default: value,
  step: 0.001,
  unit: "s",
  curve: "log",
});

/** Glide starts at 0 (off), so it sweeps linearly. */
const glide = (value: number): ParamSpec => ({
  key: "glide",
  label: "Glide",
  min: 0,
  max: 0.5,
  default: value,
  step: 0.001,
  unit: "s",
});

const amount = (key: string, label: string, value: number, max = 1): ParamSpec => ({
  key,
  label,
  min: 0,
  max,
  default: value,
  step: 0.01,
});

export const INSTRUMENTS: Readonly<Record<InstrumentKind, InstrumentSpec>> = {
  kick: {
    kind: "kick",
    label: "Kick",
    description: "Sine with a fast pitch drop and a noise click",
    melodic: false,
    defaultNote: 0,
    params: [
      { ...hz("tune", "Tune", 30, 120, 48), step: 0.5 },
      { key: "sweep", label: "Sweep", min: 0, max: 10, default: 5, step: 0.1, unit: "×" },
      seconds("bend", "Bend", 0.005, 0.2, 0.035),
      seconds("decay", "Decay", 0.05, 2, 0.45),
      amount("click", "Click", 0.35),
    ],
  },
  snare: {
    kind: "snare",
    label: "Snare",
    description: "Two-tone body under high-passed noise",
    melodic: false,
    defaultNote: 0,
    params: [
      hz("tune", "Tune", 100, 400, 185),
      amount("tone", "Tone", 0.35),
      seconds("decay", "Decay", 0.03, 1.5, 0.22),
      amount("snap", "Snap", 0.65),
    ],
  },
  hat: {
    kind: "hat",
    label: "Hat",
    description: "Metallic squares and noise: short for closed, long for open or ride",
    melodic: false,
    defaultNote: 0,
    params: [
      { key: "tone", label: "Tone", min: 0.5, max: 2, default: 1, step: 0.01, unit: "×" },
      seconds("decay", "Decay", 0.01, 2, 0.05),
      amount("metal", "Metal", 0.6),
    ],
  },
  perc: {
    kind: "perc",
    label: "Perc",
    description: "Tuned blip for rims, toms and FX",
    melodic: false,
    defaultNote: 0,
    params: [
      hz("tune", "Tune", 60, 2000, 420),
      seconds("decay", "Decay", 0.01, 1, 0.12),
      amount("bend", "Bend", 0.3),
      amount("noise", "Noise", 0.2),
    ],
  },
  sub: {
    kind: "sub",
    label: "Sub",
    description: "Sine sub bass with glide",
    melodic: true,
    defaultNote: 29,
    params: [
      glide(0.03),
      seconds("attack", "Attack", 0.001, 0.2, 0.005),
      seconds("release", "Release", 0.01, 2, 0.12),
      amount("warmth", "Warmth", 0.15),
    ],
  },
  reese: {
    kind: "reese",
    label: "Reese",
    description: "Detuned saws through a resonant 24 dB filter, with wobble",
    melodic: true,
    defaultNote: 29,
    params: [
      hz("cutoff", "Cutoff", 40, 12000, 700),
      amount("resonance", "Reso", 0.3),
      { key: "detune", label: "Detune", min: 0, max: 50, default: 18, step: 0.1, unit: "ct" },
      amount("sub", "Sub", 0.4),
      amount("env", "Env", 0.35),
      seconds("decay", "Decay", 0.01, 2, 0.3),
      { key: "rate", label: "Rate", min: 1, max: 32, default: 8, step: 1, unit: "steps" },
      amount("wobble", "Wobble", 0),
      glide(0.06),
      seconds("release", "Release", 0.01, 2, 0.15),
    ],
  },
  pluck: {
    kind: "pluck",
    label: "Pluck",
    description: "Plucked string (Karplus-Strong)",
    melodic: true,
    defaultNote: 65,
    params: [
      amount("tone", "Tone", 0.45),
      amount("decay", "Decay", 0.6),
      seconds("release", "Release", 0.01, 1, 0.08),
    ],
  },
  pad: {
    kind: "pad",
    label: "Pad",
    description:
      "Detuned saw pairs an interval apart through a slow resonant 24 dB filter: drones and stabs",
    melodic: true,
    defaultNote: 41,
    params: [
      hz("cutoff", "Cutoff", 40, 12000, 400),
      amount("resonance", "Reso", 0.25),
      { key: "interval", label: "Interval", min: 0, max: 12, default: 7, step: 1, unit: "st" },
      { key: "detune", label: "Detune", min: 0, max: 50, default: 12, step: 0.1, unit: "ct" },
      seconds("attack", "Attack", 0.001, 4, 0.4),
      amount("env", "Env", 0.2),
      seconds("decay", "Decay", 0.01, 4, 0.8),
      { key: "rate", label: "Rate", min: 1, max: 64, default: 32, step: 1, unit: "steps" },
      amount("sweep", "Sweep", 0.2),
      seconds("release", "Release", 0.01, 4, 0.6),
    ],
  },
};

export const MIXER_PARAMS: readonly ParamSpec[] = [
  { key: "level", label: "Level", min: -60, max: 6, default: 0, step: 0.1, unit: "dB" },
  { key: "pan", label: "Pan", min: -1, max: 1, default: 0, step: 0.01 },
  hz("lowcut", "Low cut", 20, 2000, 20),
  hz("highcut", "High cut", 100, 20000, 20000),
  amount("drive", "Drive", 0),
  amount("reverb", "Reverb", 0),
  amount("delay", "Delay", 0),
];

export const MASTER_PARAMS: readonly ParamSpec[] = [
  { key: "level", label: "Level", min: -60, max: 6, default: 0, step: 0.1, unit: "dB" },
  amount("glue", "Glue", 0.35),
  amount("drive", "Drive", 0.2),
];

export const REVERB_PARAMS: readonly ParamSpec[] = [
  amount("size", "Size", 0.6),
  amount("damp", "Damp", 0.6),
];

export const DELAY_PARAMS: readonly ParamSpec[] = [
  { key: "time", label: "Time", min: 1, max: 8, default: 3, step: 1, unit: "steps" },
  amount("feedback", "Feedback", 0.35, 0.9),
  amount("tone", "Tone", 0.35),
];

export const BPM: ParamSpec = {
  key: "bpm",
  label: "BPM",
  min: 60,
  max: 220,
  default: 174,
  step: 0.1,
};
export const SWING: ParamSpec = amount("swing", "Swing", 0);

/** Choke groups 1 to 8: a hit in a group cuts the others in it, as a closed hat cuts an open one. */
export const CHOKE_GROUPS = 8;

/** Rounds to the parameter's step and clamps to its range. */
export function quantize(spec: ParamSpec, value: number): number {
  const decimals = (String(spec.step).split(".")[1] ?? "").length;
  const rounded = Number((Math.round(value / spec.step) * spec.step).toFixed(decimals));
  const clamped = Math.min(spec.max, Math.max(spec.min, rounded));
  // -0 would serialize as 0 anyway, but keep comparisons exact.
  return clamped === 0 ? 0 : clamped;
}

/** Default values for a list of parameters, keyed by parameter. */
export function defaults(specs: readonly ParamSpec[]): Record<string, number> {
  return Object.fromEntries(specs.map((spec) => [spec.key, spec.default]));
}

/** The engine's self-description, as the TypeScript tables expect it. */
export function expectedEngineDescription(version: number): string {
  return [
    `version=${version}`,
    ...INSTRUMENT_KINDS.map(
      (kind) => `${kind}=${INSTRUMENTS[kind].params.map((spec) => spec.key).join(",")}`,
    ),
  ].join(";");
}

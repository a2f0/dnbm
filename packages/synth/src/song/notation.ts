// How a pattern row is written. Percussive rows take one character per step:
//
//   .  rest     o  ghost     x  hit     X  accent
//
// Melodic rows take a three-character token per step, as in a tracker:
//
//   ...  rest (releases a held note)   ---  tie (holds the note)   F-1, G#2  notes
//
// Saved rows group steps by beat and separate bars with "|", for example
// "X... ..x. .... x... | X... .... ..x. ...." and
// "F-1 --- --- ---  ... ... G#1 ---  ...". Parsing ignores the grouping, so any
// spacing is accepted, and saving writes it back canonically.

export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
export const MAX_BARS = 4;

export const REST = "...";
export const TIE = "---";
export const DRUM_REST = ".";

/** Percussive step symbols, in the order a click cycles through them. */
export const DRUM_CYCLE = [".", "x", "X", "o"] as const;
export type DrumToken = (typeof DRUM_CYCLE)[number];

export const DRUM_VELOCITY: Readonly<Record<DrumToken, number>> = {
  ".": 0,
  o: 0.4,
  x: 0.75,
  X: 1,
};

/** C-0 (MIDI 12) to B-8 (MIDI 119). */
export const LOWEST_NOTE = 12;
export const HIGHEST_NOTE = 119;

const NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
const PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function isDrumToken(token: string): token is DrumToken {
  return (DRUM_CYCLE as readonly string[]).includes(token);
}

/** The canonical token for a MIDI note, such as "F-1" or "G#2". */
export function noteToken(midi: number): string {
  const note = Math.min(HIGHEST_NOTE, Math.max(LOWEST_NOTE, Math.round(midi)));
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

/**
 * The MIDI note a token names, or undefined. Accepts "F-1", "F1", "F#1", "Gb1" and
 * lowercase letters.
 */
export function parseNote(token: string): number | undefined {
  const match = /^([A-Ga-g])([-#b]?)(\d)$/.exec(token);
  if (!match) return undefined;
  const [, letter = "", accidental, octave = ""] = match;
  const pitch = PITCH_CLASSES[letter.toUpperCase()];
  if (pitch === undefined) return undefined;
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octave) + 1) * 12 + pitch + shift;
  return midi >= LOWEST_NOTE && midi <= HIGHEST_NOTE ? midi : undefined;
}

export class RowError extends Error {}

function parseDrumRow(text: string): string[] {
  const tokens: string[] = [];
  for (const char of text.replace(/[\s|]/g, "")) {
    if (char === "-" || char === "_") {
      tokens.push(DRUM_REST);
    } else if (isDrumToken(char)) {
      tokens.push(char);
    } else {
      throw new RowError(`step ${tokens.length + 1}: "${char}" is not one of . o x X`);
    }
  }
  return tokens;
}

function parseNoteRow(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/[\s|]+/)) {
    if (word === "") continue;
    if (word === REST || word === TIE) {
      tokens.push(word);
      continue;
    }
    const midi = parseNote(word);
    if (midi === undefined) {
      throw new RowError(
        `step ${tokens.length + 1}: "${word}" is not a note (C-0 to B-8), "---" or "..."`,
      );
    }
    tokens.push(noteToken(midi));
  }
  return tokens;
}

/** Parses a row into one canonical token per step. */
export function parseRow(text: string, melodic: boolean, steps: number): string[] {
  const tokens = melodic ? parseNoteRow(text) : parseDrumRow(text);
  if (tokens.length !== steps) {
    throw new RowError(`has ${tokens.length} steps; the pattern has ${steps}`);
  }
  return tokens;
}

/** Writes a row canonically: beats grouped, bars separated by "|". */
export function formatRow(tokens: readonly string[], melodic: boolean): string {
  const bars: string[] = [];
  for (let bar = 0; bar * STEPS_PER_BAR < tokens.length; bar++) {
    const beats: string[] = [];
    for (let beat = 0; beat < STEPS_PER_BAR / STEPS_PER_BEAT; beat++) {
      const start = bar * STEPS_PER_BAR + beat * STEPS_PER_BEAT;
      const steps = tokens.slice(start, start + STEPS_PER_BEAT);
      beats.push(melodic ? steps.join(" ") : steps.join(""));
    }
    bars.push(beats.join(melodic ? "  " : " "));
  }
  return bars.join(" | ");
}

/** A row of rests. */
export function emptyRow(bars: number, melodic: boolean): string[] {
  return Array.from({ length: bars * STEPS_PER_BAR }, () => (melodic ? REST : DRUM_REST));
}

/** Converts a row between percussive and melodic notation, keeping where it plays. */
export function convertRow(tokens: readonly string[], melodic: boolean, note: number): string[] {
  if (melodic) {
    return tokens.map((token) =>
      isDrumToken(token) && token !== DRUM_REST ? noteToken(note) : REST,
    );
  }
  return tokens.map((token) =>
    token === REST || token === TIE || isDrumToken(token) ? DRUM_REST : "x",
  );
}

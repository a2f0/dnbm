// A song in memory. Rows hold one canonical token per step (see notation.ts); every
// other value is already rounded to its parameter's step (see instruments.ts). Treat a
// Song as immutable: SongStore replaces it on every edit.

import type { InstrumentKind } from "./instruments";

export interface Mixer {
  level: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  lowcut: number;
  highcut: number;
  drive: number;
  reverb: number;
  delay: number;
}

export interface Track {
  id: string;
  instrument: InstrumentKind;
  /** 0 for none, or a group from 1 to 8 whose hits cut each other off. */
  choke: number;
  mixer: Mixer;
  params: Record<string, number>;
}

export interface Pattern {
  id: string;
  bars: number;
  /** One token per step for every track, keyed by track id. */
  rows: Record<string, string[]>;
}

export interface Song {
  title: string;
  bpm: number;
  swing: number;
  master: { level: number; glue: number; drive: number };
  reverb: { size: number; damp: number };
  delay: { time: number; feedback: number; tone: number };
  tracks: Track[];
  patterns: Pattern[];
  /** Pattern ids in playing order. */
  arrangement: string[];
}

export const MAX_TRACKS = 16;
export const MAX_PATTERNS = 64;
export const MAX_ARRANGEMENT = 1024;
export const ID_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;

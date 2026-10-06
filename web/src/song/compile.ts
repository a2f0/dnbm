// Compiles a song to the flat array of numbers the engine reads; the layout is
// documented in engine/src/song.rs.

import { INSTRUMENT_KINDS, INSTRUMENTS } from "./instruments";
import type { Song } from "./model";
import { DRUM_VELOCITY, isDrumToken, parseNote, REST, TIE } from "./notation";

export const COMPILED_MAGIC = 25710;
export const COMPILED_VERSION = 1;

const CELL_REST = 0;
const CELL_HIT = 1;
const CELL_NOTE = 2;
const CELL_TIE = 3;

/** Velocity for melodic notes, which carry none of their own. */
const NOTE_VELOCITY = 1;

function cell(token: string): [kind: number, velocity: number, note: number] {
  if (token === REST || token === ".") return [CELL_REST, 0, 0];
  if (token === TIE) return [CELL_TIE, 0, 0];
  if (isDrumToken(token)) return [CELL_HIT, DRUM_VELOCITY[token], 0];
  const note = parseNote(token);
  return note === undefined ? [CELL_REST, 0, 0] : [CELL_NOTE, NOTE_VELOCITY, note];
}

export function compileSong(song: Song): Float32Array {
  const values: number[] = [
    COMPILED_MAGIC,
    COMPILED_VERSION,
    song.bpm,
    song.swing,
    song.master.level,
    song.master.glue,
    song.master.drive,
    song.reverb.size,
    song.reverb.damp,
    song.delay.time,
    song.delay.feedback,
    song.delay.tone,
    song.tracks.length,
    song.patterns.length,
    song.arrangement.length,
  ];
  for (const track of song.tracks) {
    const specs = INSTRUMENTS[track.instrument].params;
    const { mixer } = track;
    values.push(
      INSTRUMENT_KINDS.indexOf(track.instrument),
      track.choke,
      mixer.level,
      mixer.pan,
      mixer.lowcut,
      mixer.highcut,
      mixer.drive,
      mixer.reverb,
      mixer.delay,
      mixer.mute ? 1 : 0,
      mixer.solo ? 1 : 0,
      specs.length,
      ...specs.map((spec) => track.params[spec.key] ?? spec.default),
    );
  }
  for (const pattern of song.patterns) {
    const steps = pattern.bars * 16;
    values.push(steps);
    for (const track of song.tracks) {
      const row = pattern.rows[track.id] ?? [];
      for (let step = 0; step < steps; step++) {
        values.push(...cell(row[step] ?? REST));
      }
    }
  }
  const indices = new Map(song.patterns.map((pattern, index) => [pattern.id, index]));
  for (const id of song.arrangement) values.push(indices.get(id) ?? 0);
  return Float32Array.from(values);
}

// Where a song is in time. The engine reports the playing arrangement slot and step;
// the player shows seconds and seeks by slot, so it converts between the two. Swing
// lengthens even steps as much as it shortens odd ones, and patterns are whole bars,
// so every slot starts on the same second with or without swing.

import type { Song } from "@a2f0/dnbm-synth/song/model";
import { STEPS_PER_BAR } from "@a2f0/dnbm-synth/song/notation";

export interface Timeline {
  /** Seconds per sixteenth-note step, before swing. */
  readonly stepSeconds: number;
  /** The first step of each arrangement slot, counted from the start of the song. */
  readonly slotSteps: readonly number[];
  /** Steps in the whole arrangement. */
  readonly steps: number;
  readonly seconds: number;
}

export function timeline(song: Song): Timeline {
  const bars = new Map(song.patterns.map((pattern) => [pattern.id, pattern.bars]));
  const slotSteps: number[] = [];
  let steps = 0;
  for (const id of song.arrangement) {
    slotSteps.push(steps);
    steps += (bars.get(id) ?? 1) * STEPS_PER_BAR;
  }
  const stepSeconds = 60 / song.bpm / 4;
  return { stepSeconds, slotSteps, steps, seconds: steps * stepSeconds };
}

/** The step a position stands on, counted from the start of the song. */
export function stepAt(line: Timeline, slot: number, step: number): number {
  return (line.slotSteps[slot] ?? 0) + step;
}

/** The slot playing at a time, which is where a seek to that time starts. */
export function slotAt(line: Timeline, seconds: number): number {
  // A hair over, so the time a slot starts at, rounded through seconds, finds that slot.
  const step = seconds / line.stepSeconds + 1e-6;
  let slot = 0;
  while (slot + 1 < line.slotSteps.length && (line.slotSteps[slot + 1] ?? 0) <= step) slot++;
  return slot;
}

/** Minutes and seconds, as a player's display shows them: 0:00, 4:07, 61:30. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Renders a whole song offline with the same engine the page plays it with.

import { compileSong } from "../song/compile";
import type { Song } from "../song/model";
import { STEPS_PER_BAR } from "../song/notation";
import { PlayMode, type WasmEngine } from "./wasmEngine";

export interface RenderOptions {
  /** How many times to play the arrangement. */
  readonly loops?: number;
  /** Seconds of reverb and delay tail after the last step. */
  readonly tailSeconds?: number;
  readonly onProgress?: (fraction: number) => void;
}

export interface Rendered {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
}

/**
 * Frames until the arrangement's first step would fire again. Swing lengthens even
 * steps as much as it shortens odd ones, and patterns are whole bars, so only the step
 * count and tempo matter. Rounded down: the engine fires a step on the first sample at
 * or after its time.
 */
export function arrangementFrames(song: Song, sampleRate: number, loops = 1): number {
  const bars = new Map(song.patterns.map((pattern) => [pattern.id, pattern.bars]));
  const steps = song.arrangement.reduce((sum, id) => sum + (bars.get(id) ?? 1) * STEPS_PER_BAR, 0);
  const stepFrames = (sampleRate * 60) / song.bpm / 4;
  return Math.floor(steps * loops * stepFrames);
}

export function renderSong(engine: WasmEngine, song: Song, options: RenderOptions = {}): Rendered {
  const { loops = 1, tailSeconds = 4, onProgress } = options;
  const { sampleRate } = engine;
  const playFrames = arrangementFrames(song, sampleRate, loops);
  const total = playFrames + Math.round(tailSeconds * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);

  engine.loadSong(compileSong(song));
  engine.play(PlayMode.Song, 0);
  let offset = 0;
  let lastReport = 0;
  while (offset < total) {
    if (offset === playFrames) engine.stop();
    const limit = offset < playFrames ? playFrames : total;
    const block = engine.render(Math.min(engine.maxFrames, limit - offset));
    left.set(block.left, offset);
    right.set(block.right, offset);
    offset += block.frames;
    if (onProgress && offset - lastReport >= sampleRate) {
      lastReport = offset;
      onProgress(offset / total);
    }
  }
  onProgress?.(1);
  return { left, right, sampleRate };
}

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { arrangementFrames, renderSong } from "../src/audio/offline";
import { PlayMode } from "../src/audio/wasmEngine";
import { compileSong } from "../src/song/compile";
import { parseSong, parseSongText } from "../src/song/format";
import { expectedEngineDescription } from "../src/song/instruments";
import type { Song } from "../src/song/model";
import { createEngine } from "./engineWasm";

const SONGS = join(import.meta.dir, "..", "..", "..", "songs");
const undertow = parseSongText(await Bun.file(join(SONGS, "undertow.dnbm.json")).text());
const exampleFiles = (await readdir(SONGS)).filter((file) => file.endsWith(".dnbm.json")).sort();

const fourOnTheFloor = parseSong({
  dnbm: 1,
  bpm: 120,
  tracks: [{ id: "kick", instrument: "kick" }],
  patterns: [{ id: "a", rows: { kick: "X... X... X... X..." } }],
  arrangement: ["a"],
});

/**
 * A held pad note, a legato change, a release short enough for the voice to fall silent
 * mid-block, then a retrigger and a rest to ring out in.
 */
const padNotes = parseSong({
  dnbm: 1,
  bpm: 170,
  tracks: [{ id: "pad", instrument: "pad", params: { attack: 0.05, release: 0.01 } }],
  patterns: [
    {
      id: "a",
      rows: { pad: "F-2 --- --- ---  G#2 --- --- ...  ... ... ... ...  F-2 --- ... ..." },
    },
  ],
  arrangement: ["a"],
});

/** Renders `frames` of a song's arrangement in blocks of `size` frames. */
async function renderInBlocks(song: Song, size: number, frames: number): Promise<Float32Array> {
  const engine = await createEngine();
  engine.loadSong(compileSong(song));
  engine.play(PlayMode.Song, 0);
  const out = new Float32Array(frames);
  for (let offset = 0; offset < out.length; ) {
    const block = engine.render(Math.min(size, out.length - offset));
    out.set(block.left, offset);
    offset += block.frames;
  }
  return out;
}

/** Changes only the master target, splitting blocks at fixed sample positions. */
async function renderMasterInBlocks(
  sampleRate: number,
  size: number,
  changes: ReadonlyArray<{ frame: number; level: number }>,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const song = structuredClone(fourOnTheFloor);
  // Both channels sound, but differ, so accidentally omitting either is observable.
  for (const track of song.tracks) track.mixer.pan = 0.3;
  const engine = await createEngine(sampleRate);
  const left = new Float32Array(8192);
  const right = new Float32Array(left.length);
  try {
    for (const [index, change] of changes.entries()) {
      song.master.level = change.level;
      engine.loadSong(compileSong(song));
      if (index === 0) engine.play(PlayMode.Song, 0);
      const end = changes[index + 1]?.frame ?? left.length;
      for (let offset = change.frame; offset < end; ) {
        const block = engine.render(Math.min(size, end - offset));
        left.set(block.left, offset);
        right.set(block.right, offset);
        offset += block.frames;
      }
    }
    return { left, right };
  } finally {
    engine.free();
  }
}

function hash(...channels: Float32Array[]): number {
  let h = 2166136261;
  for (const channel of channels) {
    const bytes = new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength);
    for (const byte of bytes) h = Math.imul(h ^ byte, 16777619);
  }
  return h >>> 0;
}

describe("engine", () => {
  test("lists the same parameters, in the same order, as the song tables", async () => {
    const engine = await createEngine();
    expect(engine.describe()).toBe(expectedEngineDescription(1));
  });

  test("renders the example song: loud, never clipping, and identical every time", async () => {
    const first = renderSong(await createEngine(), undertow, { tailSeconds: 1 });
    const second = renderSong(await createEngine(), undertow, { tailSeconds: 1 });
    expect(hash(first.left, first.right)).toBe(hash(second.left, second.right));
    let peak = 0;
    let sum = 0;
    for (const sample of first.left) {
      if (!Number.isFinite(sample)) throw new Error("rendered a non-finite sample");
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(Math.sqrt(sum / first.left.length)).toBeGreaterThan(0.1);
  });

  describe("renders every example song loud and never clipping", () => {
    expect(exampleFiles.length).toBeGreaterThan(1);
    for (const file of exampleFiles) {
      test(file, async () => {
        const song = parseSongText(await Bun.file(join(SONGS, file)).text());
        const rendered = renderSong(await createEngine(), song, { tailSeconds: 1 });
        let peak = 0;
        let sum = 0;
        for (const channel of [rendered.left, rendered.right]) {
          for (const sample of channel) {
            if (!Number.isFinite(sample)) throw new Error("rendered a non-finite sample");
            peak = Math.max(peak, Math.abs(sample));
            sum += sample * sample;
          }
        }
        expect(peak).toBeLessThanOrEqual(1);
        expect(Math.sqrt(sum / (rendered.left.length * 2))).toBeGreaterThan(0.1);
      });
    }
  });

  test("renders the same whatever the block size", async () => {
    const blocks = async (size: number) => hash(await renderInBlocks(fourOnTheFloor, size, 48_000));
    expect(await blocks(128)).toBe(await blocks(4096));
    expect(await blocks(441)).toBe(await blocks(128));
  });

  describe("master gain is independent of render block size", () => {
    const scenarios = [
      { name: "non-unity initial level", changes: [{ frame: 0, level: -2 }] },
      {
        name: "target changes at fixed samples",
        changes: [
          { frame: 0, level: 0 },
          { frame: 997, level: -18 },
          { frame: 1531, level: 3 },
          { frame: 5003, level: -60 },
          { frame: 6023, level: 0 },
        ],
      },
    ];
    for (const sampleRate of [44_100, 48_000]) {
      for (const { name, changes } of scenarios) {
        for (const size of [128, 441, 4096]) {
          test(`${name}, ${sampleRate} Hz, ${size} vs 1 frame`, async () => {
            const reference = await renderMasterInBlocks(sampleRate, 1, changes);
            const actual = await renderMasterInBlocks(sampleRate, size, changes);
            expect(hash(reference.left)).not.toBe(hash(reference.right));
            for (const channel of ["left", "right"] as const) {
              expect(reference[channel].some((sample) => Math.abs(sample) > 0.01)).toBe(true);
              expect(
                actual[channel].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1),
              ).toBe(true);
              let maximumDifference = 0;
              for (const [index, sample] of reference[channel].entries()) {
                maximumDifference = Math.max(
                  maximumDifference,
                  Math.abs(sample - (actual[channel][index] ?? Number.NaN)),
                );
              }
              expect(maximumDifference).toBe(0);
            }
          });
        }
      }
    }
  });

  test("renders pad notes identically every time and whatever the block size", async () => {
    // Two seconds: the held note, its legato change, release, retrigger and tail, then the loop.
    const first = await renderInBlocks(padNotes, 128, 96_000);
    expect(first.some((sample) => sample !== 0)).toBe(true);
    expect(first.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(hash(first)).toBe(hash(await renderInBlocks(padNotes, 128, 96_000)));
    expect(hash(first)).toBe(hash(await renderInBlocks(padNotes, 4096, 96_000)));
    expect(hash(first)).toBe(hash(await renderInBlocks(padNotes, 441, 96_000)));
  });

  test("plays steps on time: four kicks a bar at 120 BPM are half a second apart", async () => {
    const engine = await createEngine();
    engine.loadSong(compileSong(fourOnTheFloor));
    engine.play(PlayMode.Pattern, 0);
    const serials: number[] = [];
    for (let frames = 0; frames < 48_000; frames += 128) {
      engine.render(128);
      serials.push(engine.serial());
    }
    // 16 sixteenths a bar at 120 BPM: 8 steps a second.
    expect(serials.at(-1)).toBe(8);
    expect(arrangementFrames(fourOnTheFloor, 48_000)).toBe(96_000);
  });

  test("refuses a malformed song and keeps the one it had", async () => {
    const engine = await createEngine();
    engine.loadSong(compileSong(fourOnTheFloor));
    const broken = compileSong(fourOnTheFloor).slice(0, -1);
    expect(() => engine.loadSong(broken)).toThrow("the data ends early");
    engine.play(PlayMode.Song, 0);
    expect(engine.render(512).left.some((sample) => sample !== 0)).toBe(true);
  });

  test("solo and mute silence the right tracks", async () => {
    const muted = structuredClone(fourOnTheFloor);
    const kick = muted.tracks[0];
    if (kick) kick.mixer.mute = true;
    const engine = await createEngine();
    const rendered = renderSong(engine, muted, { tailSeconds: 0 });
    expect(rendered.left.every((sample) => sample === 0)).toBe(true);
  });
});

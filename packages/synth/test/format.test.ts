import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newSong } from "../src/song/defaults";
import {
  normalizeSong,
  parseSong,
  parseSongText,
  SongError,
  serializeSong,
} from "../src/song/format";
import { INSTRUMENT_KINDS, INSTRUMENTS } from "../src/song/instruments";
import { songSchema } from "../src/song/schema";

const SONGS = join(import.meta.dir, "..", "..", "..", "songs");

const minimal = {
  dnbm: 1,
  tracks: [{ id: "kick", instrument: "kick" }],
  patterns: [{ id: "a", rows: { kick: "X... .... X... ...." } }],
  arrangement: ["a"],
};

function errorOf(data: unknown): string {
  try {
    parseSong(data);
  } catch (error) {
    if (error instanceof SongError) return error.message;
    throw error;
  }
  throw new Error("parsed without error");
}

describe("song files", () => {
  test("every example song is valid and canonical", () => {
    const files = readdirSync(SONGS).filter((file) => file.endsWith(".dnbm.json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(SONGS, file), "utf8");
      expect(serializeSong(parseSongText(text))).toBe(text);
    }
  });

  test("a minimal song fills in every default", () => {
    const song = parseSong(minimal);
    expect(song.bpm).toBe(174);
    expect(song.tracks[0]?.params).toEqual({
      tune: 48,
      sweep: 5,
      bend: 0.035,
      decay: 0.45,
      click: 0.35,
    });
    expect(song.patterns[0]?.bars).toBe(1);
  });

  test("serializing is stable: saving twice writes the same bytes", () => {
    const once = serializeSong(parseSong(minimal));
    expect(serializeSong(parseSongText(once))).toBe(once);
    expect(once.endsWith("}\n")).toBe(true);
  });

  test("a pattern row is one line, so a step edit is a one-line diff", () => {
    const song = parseSong(minimal);
    const before = serializeSong(song).split("\n");
    const edited = structuredClone(song);
    const row = edited.patterns[0]?.rows["kick"];
    if (row) row[5] = "x";
    const after = serializeSong(edited).split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((line, index) => line !== before[index])).toEqual([
      '        "kick": "X... .x.. X... ...."',
    ]);
  });

  test("values round to their step, so float noise never reaches a file", () => {
    const song = parseSong({ ...minimal, bpm: 174.04999999, swing: 0.1 + 0.2 });
    expect(song.bpm).toBe(174);
    expect(song.swing).toBe(0.3);
  });

  test("errors name the path", () => {
    expect(errorOf({ ...minimal, dnbm: 2 })).toBe("song.dnbm: must be 1 (the song format version)");
    expect(errorOf({ ...minimal, bpm: 400 })).toBe("song.bpm: 400 is outside 60 to 220");
    expect(errorOf({ ...minimal, tempo: 1 })).toContain('song: unknown key "tempo"');
    expect(errorOf({ ...minimal, arrangement: ["b"] })).toBe(
      'song.arrangement[0]: "b" is not a pattern id',
    );
    expect(
      errorOf({ ...minimal, tracks: [{ id: "kick", instrument: "kick", params: { tone: 1 } }] }),
    ).toContain('song.tracks[0].params: unknown key "tone"');
    expect(errorOf({ ...minimal, patterns: [{ id: "a", rows: { kick: "X?" } }] })).toBe(
      'song.patterns[0].rows.kick: step 2: "?" is not one of . o x X',
    );
    expect(
      errorOf({ ...minimal, tracks: [...minimal.tracks, { id: "kick", instrument: "snare" }] }),
    ).toBe('song.tracks[1].id: duplicate track id "kick"');
    expect(errorOf({ ...minimal, tracks: [{ id: "Kick", instrument: "kick" }] })).toContain(
      "song.tracks[0].id",
    );
  });

  test("a new song is valid", () => {
    const song = newSong();
    expect(normalizeSong(song)).toEqual(song);
  });
});

describe("schema", () => {
  test("lists every instrument's parameters", () => {
    const text = JSON.stringify(songSchema());
    for (const kind of INSTRUMENT_KINDS) {
      expect(text).toContain(`"const":"${kind}"`);
      for (const spec of INSTRUMENTS[kind].params)
        expect(text).toContain(`"${spec.key}":{"type":"number"`);
    }
  });
});

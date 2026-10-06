import { describe, expect, test } from "bun:test";
import {
  convertRow,
  emptyRow,
  formatRow,
  noteToken,
  parseNote,
  parseRow,
  RowError,
} from "../src/song/notation";

describe("notes", () => {
  test("name MIDI notes tracker-style", () => {
    expect(noteToken(29)).toBe("F-1");
    expect(noteToken(30)).toBe("F#1");
    expect(noteToken(60)).toBe("C-4");
  });

  test("parse every spelling", () => {
    for (const spelling of ["F-1", "F1", "f1"]) expect(parseNote(spelling)).toBe(29);
    expect(parseNote("F#1")).toBe(30);
    expect(parseNote("Gb1")).toBe(30);
    expect(parseNote("H2")).toBeUndefined();
    expect(parseNote("C-9")).toBeUndefined();
  });
});

describe("rows", () => {
  test("format drums by beat and bar", () => {
    const tokens = parseRow("X...x...", false, 8).concat(
      emptyRow(1, false).slice(8),
      emptyRow(1, false),
    );
    expect(formatRow(tokens, false)).toBe("X... x... .... .... | .... .... .... ....");
  });

  test("format notes by beat and bar", () => {
    const row = parseRow(`F1 --- ... G#1 ${"... ".repeat(12)}`, true, 16);
    expect(formatRow(row, true)).toBe(
      "F-1 --- ... G#1  ... ... ... ...  ... ... ... ...  ... ... ... ...",
    );
  });

  test("ignore spacing and bar lines when parsing", () => {
    expect(parseRow(" x.|x.  ", false, 4)).toEqual(["x", ".", "x", "."]);
    expect(parseRow("-_.X", false, 4)).toEqual([".", ".", ".", "X"]);
  });

  test("round-trip through the canonical form", () => {
    const text = "X... ..x. .o.. x... | X... .... ..x. ..X.";
    expect(formatRow(parseRow(text, false, 32), false)).toBe(text);
  });

  test("reject bad symbols and lengths with the step", () => {
    expect(() => parseRow("x.y.", false, 4)).toThrow(
      new RowError('step 3: "y" is not one of . o x X'),
    );
    expect(() => parseRow("x...", false, 16)).toThrow("has 4 steps; the pattern has 16");
    expect(() => parseRow("F-1 Q-2", true, 2)).toThrow("step 2");
  });

  test("convert between hits and notes, keeping where they play", () => {
    expect(convertRow(["x", ".", "o", "."], true, 29)).toEqual(["F-1", "...", "F-1", "..."]);
    expect(convertRow(["F-1", "---", "...", "C-2"], false, 0)).toEqual(["x", ".", ".", "x"]);
  });
});

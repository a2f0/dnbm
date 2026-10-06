import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arrangementFrames } from "@a2f0/dnbm-synth/audio/offline";
import { parseSongText } from "@a2f0/dnbm-synth/song/format";
import { clock, slotAt, stepAt, timeline } from "../src/timeline";

const undertow = parseSongText(
  readFileSync(join(import.meta.dir, "..", "..", "..", "songs", "undertow.dnbm.json"), "utf8"),
);

describe("timeline", () => {
  test("lasts as long as the engine plays the arrangement", () => {
    const line = timeline(undertow);
    const rate = 48_000;
    expect(Math.floor(line.seconds * rate)).toBe(arrangementFrames(undertow, rate));
    expect(line.slotSteps).toHaveLength(undertow.arrangement.length);
  });

  test("converts between positions and time", () => {
    const line = timeline(undertow);
    for (const [slot, first] of line.slotSteps.entries()) {
      expect(stepAt(line, slot, 0)).toBe(first);
      expect(slotAt(line, first * line.stepSeconds)).toBe(slot);
      expect(slotAt(line, (first + 1) * line.stepSeconds)).toBe(slot);
    }
    expect(slotAt(line, -1)).toBe(0);
    expect(slotAt(line, line.seconds + 60)).toBe(line.slotSteps.length - 1);
  });

  test("formats a clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59.9)).toBe("0:59");
    expect(clock(247)).toBe("4:07");
    expect(clock(3690)).toBe("61:30");
    expect(clock(-2)).toBe("0:00");
  });
});

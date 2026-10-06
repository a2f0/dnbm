import { expect, test } from "bun:test";
import { encodeWav } from "../src/audio/wav";

test("writes a 24-bit stereo WAV", () => {
  const left = Float32Array.from([0, 1, -1]);
  const right = Float32Array.from([0.5, 0, 2]);
  const bytes = encodeWav(left, right, 48_000);
  const view = new DataView(bytes.buffer);
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(48_000);
  expect(view.getUint16(34, true)).toBe(24);
  expect(view.getUint32(40, true)).toBe(3 * 2 * 3);
  // Frame 1, left: full scale positive.
  expect([...bytes.subarray(44 + 6, 44 + 9)]).toEqual([0xff, 0xff, 0x7f]);
  // Frame 2, right: clipped to full scale positive.
  expect([...bytes.subarray(44 + 15, 44 + 18)]).toEqual([0xff, 0xff, 0x7f]);
});

import { describe, expect, test } from "bun:test";
import { Playlist } from "../src/playlist";

/** A seeded generator, so a shuffle is the same every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** Every song from `start`, following `next` until it stops. */
function walk(playlist: Playlist, start: number): number[] {
  const order = [start];
  for (let at = playlist.next(start); at !== undefined; at = playlist.next(at)) {
    if (order.includes(at)) break;
    order.push(at);
  }
  return order;
}

describe("playlist", () => {
  test("plays in order and stops at the end unless it repeats", () => {
    const playlist = new Playlist(3);
    expect(walk(playlist, 0)).toEqual([0, 1, 2]);
    expect(playlist.next(2)).toBeUndefined();
    expect(playlist.previous(0)).toBeUndefined();
    playlist.repeat = true;
    expect(playlist.next(2)).toBe(0);
    expect(playlist.previous(0)).toBe(2);
  });

  test("the buttons wrap even without repeat", () => {
    const playlist = new Playlist(3);
    expect(playlist.next(2, true)).toBe(0);
    expect(playlist.previous(0, true)).toBe(2);
  });

  test("shuffle plays every song once, starting from the current one", () => {
    const playlist = new Playlist(11, seeded(7));
    playlist.setShuffle(true, 4);
    const order = walk(playlist, 4);
    expect(order[0]).toBe(4);
    expect([...order].sort((a, b) => a - b)).toEqual([...Array(11).keys()]);
    expect(order).not.toEqual([4, 5, 6, 7, 8, 9, 10]);
    playlist.setShuffle(false, order[5] ?? 0);
    expect(walk(playlist, 0)).toEqual([...Array(11).keys()]);
  });

  test("an empty playlist has nothing to play", () => {
    const playlist = new Playlist(0);
    expect(playlist.next(0, true)).toBeUndefined();
    expect(playlist.previous(0, true)).toBeUndefined();
  });
});

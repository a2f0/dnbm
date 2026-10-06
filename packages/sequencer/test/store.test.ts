import { describe, expect, test } from "bun:test";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { SongStore } from "../src/store";

describe("song store", () => {
  test("undoes and redoes edits", () => {
    const store = new SongStore(newSong());
    store.update((song) => {
      song.bpm = 170;
    });
    expect(store.song.bpm).toBe(170);
    store.undo();
    expect(store.song.bpm).toBe(174);
    store.redo();
    expect(store.song.bpm).toBe(170);
  });

  test("groups a gesture into one undo step", () => {
    const store = new SongStore(newSong());
    for (const bpm of [175, 176, 177]) {
      store.update((song) => {
        song.bpm = bpm;
      }, "drag");
    }
    store.endGesture();
    store.undo();
    expect(store.song.bpm).toBe(174);
    expect(store.canUndo).toBe(false);
  });

  test("normalizes edits and ignores ones that change nothing", () => {
    const store = new SongStore(newSong());
    store.update((song) => {
      song.swing = 0.123456;
    });
    expect(store.song.swing).toBe(0.12);
    store.update((song) => {
      song.swing = 0.12;
    });
    store.undo();
    expect(store.song.swing).toBe(0);
  });

  test("tracks unsaved changes", () => {
    const store = new SongStore(newSong());
    expect(store.dirty).toBe(false);
    store.update((song) => {
      song.title = "Night Bus";
    });
    expect(store.dirty).toBe(true);
    store.markSaved();
    expect(store.dirty).toBe(false);
  });

  test("refuses an invalid edit and keeps the song", () => {
    const store = new SongStore(newSong());
    expect(() =>
      store.update((song) => {
        song.arrangement = ["missing"];
      }),
    ).toThrow("is not a pattern id");
    expect(store.song.arrangement).toEqual(["a"]);
  });
});

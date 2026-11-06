// Reopening the last session's song: an autosave this version can't read survives the
// editor's next autosave instead of being silently replaced.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { serializeSong } from "@a2f0/dnbm-synth/song/format";
import {
  AUTOSAVE_KEY,
  readStorage,
  restoreSong,
  SAVED_KEY,
  UNREADABLE_KEY,
  writeStorage,
} from "../src/storage";

const scope = globalThis as Record<string, unknown>;
let original: unknown;
let had = false;

/** A browser storage area held in a map. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

beforeEach(() => {
  had = "localStorage" in scope;
  original = scope["localStorage"];
  scope["localStorage"] = memoryStorage();
});

afterEach(() => {
  if (had) scope["localStorage"] = original;
  else delete scope["localStorage"];
});

function fallback() {
  const song = newSong();
  song.title = "Example";
  return song;
}

describe("restoring the last song", () => {
  test("reopens a readable autosave with its saved text", () => {
    const song = newSong();
    song.title = "Last Session";
    writeStorage(AUTOSAVE_KEY, serializeSong(song));
    writeStorage(SAVED_KEY, "saved text");
    const restored = restoreSong(fallback);
    expect(restored.song.title).toBe("Last Session");
    expect(restored.saved).toBe("saved text");
    expect(restored.problem).toBeUndefined();
  });

  test("starts from the fallback on a first visit", () => {
    const restored = restoreSong(fallback);
    expect(restored.song.title).toBe("Example");
    expect(restored.saved).toBeUndefined();
    expect(restored.problem).toBeUndefined();
    expect(readStorage(UNREADABLE_KEY)).toBeNull();
  });

  test("keeps an autosave it can't read when the next autosave replaces it", () => {
    // A song a newer format version wrote, as a newer dnbm on the same site would.
    const newer = serializeSong(newSong()).replace('"dnbm": 1', '"dnbm": 2');
    expect(newer).not.toBe(serializeSong(newSong()));
    writeStorage(AUTOSAVE_KEY, newer);
    const restored = restoreSong(fallback);
    expect(restored.song.title).toBe("Example");
    expect(restored.saved).toBeUndefined();
    expect(restored.problem).toContain("song.dnbm");
    expect(restored.problem).toContain(UNREADABLE_KEY);
    // The editor autosaves its song on the first change.
    writeStorage(AUTOSAVE_KEY, serializeSong(restored.song));
    expect(readStorage(UNREADABLE_KEY)).toBe(newer);
  });
});

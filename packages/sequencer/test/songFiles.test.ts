// The song's file commands when they overlap: only the latest request that replaces the
// song may load, and a save that a newer song overtook leaves that song's file alone.

import { describe, expect, test } from "bun:test";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { serializeSong } from "@a2f0/dnbm-synth/song/format";
import type { SongFiles as SongFilesType } from "../src/songFiles";
import { SongStore } from "../src/store";
import type { Dialogs } from "../src/ui/dialog";
import type { View } from "../src/view";

// ui/files.ts reads `window` as it loads; the pickers it looks for stay absent.
const scope = globalThis as Record<string, unknown>;
const hadWindow = "window" in scope;
scope["window"] ??= globalThis;
const { SongFiles } = await import("../src/songFiles");
if (!hadWindow) delete scope["window"];

function songText(title: string): string {
  const song = newSong();
  song.title = title;
  return serializeSong(song);
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function songFiles(): { files: SongFilesType; store: SongStore } {
  const store = new SongStore(newSong());
  const view = {
    patternId: "a",
    trackId: "",
    startSlot: 0,
    penNotes: new Map(),
  } as unknown as View;
  const files = new SongFiles({
    store,
    view,
    dialogs: { confirm: async () => true } as unknown as Dialogs,
    signal: new AbortController().signal,
    asset: (path) => new URL(path, "http://dnbm.test/"),
    say: () => {},
    render: () => {},
    stop: () => {},
    autosave: () => {},
  });
  return { files, store };
}

/** Replaces `fetch` while `run` runs, with a response that waits for `body`. */
async function withFetch(body: Promise<string>, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(await body)) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("song files", () => {
  test("an example that loads after a newer open does not replace it", async () => {
    const { files, store } = songFiles();
    const example = deferred<string>();
    await withFetch(example.promise, async () => {
      const opening = files.openExample("wraith.dnbm.json");
      await Bun.sleep(0);
      // A drop or a picked file opens while the example is still loading.
      files.openText(songText("Opened Later"), "opened-later.dnbm.json");
      example.resolve(songText("Wraith"));
      await opening;
    });
    expect(store.song.title).toBe("Opened Later");
    expect(files.fileName()).toBe("opened-later.dnbm.json");
  });

  test("a dropped file whose text arrives after a newer example does not replace it", async () => {
    const { files, store } = songFiles();
    const dropped = deferred<string>();
    const file = { name: "dropped.dnbm.json", text: () => dropped.promise } as unknown as File;
    const dropping = files.openDropped(file);
    await Bun.sleep(0);
    await withFetch(Promise.resolve(songText("Wraith")), () =>
      files.openExample("wraith.dnbm.json"),
    );
    dropped.resolve(songText("Dropped"));
    await dropping;
    expect(store.song.title).toBe("Wraith");
  });

  test("a save that a newer song overtook does not adopt its file", async () => {
    const { files, store } = songFiles();
    const closed = deferred<void>();
    const handle = {
      name: "first.dnbm.json",
      createWritable: async () => ({
        write: async () => {},
        close: () => closed.promise,
        abort: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    files.openText(songText("First"), "first.dnbm.json", handle);
    store.update((song) => {
      song.bpm = 170;
    });
    const saving = files.save();
    await Bun.sleep(0);
    files.openText(songText("Second"), "second.dnbm.json");
    closed.resolve();
    await saving;
    expect(store.song.title).toBe("Second");
    // Saving now must not write the second song over the first song's file.
    expect(files.fileName()).toBe("second.dnbm.json");
    expect(store.dirty).toBe(false);
  });

  test("a save started as a new song replaces the old one does not adopt its file", async () => {
    const { files, store } = songFiles();
    const closed = deferred<void>();
    const handle = {
      name: "first.dnbm.json",
      createWritable: async () => ({
        write: async () => {},
        close: () => closed.promise,
        abort: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    files.openText(songText("First"), "first.dnbm.json", handle);
    // A host's `run("new"); run("save")` in one task: the save writes the first song.
    const creating = files.newSong();
    const saving = files.save();
    await creating;
    closed.resolve();
    await saving;
    expect(store.song.title).not.toBe("First");
    expect(files.fileName()).not.toBe("first.dnbm.json");
  });
});

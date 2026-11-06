// Exporting WAV when the engine can't load: the export fails with what didn't load,
// before it starts a worker.

import { describe, expect, test } from "bun:test";
import { newSong } from "@a2f0/dnbm-synth/song/defaults";
import { renderWav } from "../src/wavExport";

describe("WAV export", () => {
  test("an engine that fails to load is reported, and no worker starts", async () => {
    const original = globalThis.fetch;
    // A host's missing asset: its server answers with an HTML error page.
    globalThis.fetch = (async () =>
      new Response("<!doctype html><title>Not found</title>", {
        status: 404,
      })) as unknown as typeof fetch;
    let songRead = false;
    const engine = new URL("http://dnbm.test/assets/engine.wasm");
    try {
      const rendering = renderWav({
        engine,
        worker: new URL("http://dnbm.test/assets/renderWorker.js"),
        song: () => {
          songRead = true;
          return newSong();
        },
        signal: new AbortController().signal,
        onProgress: () => {},
      });
      await expect(rendering).rejects.toThrow(`Couldn't load ${engine} (404).`);
    } finally {
      globalThis.fetch = original;
    }
    expect(songRead).toBe(false);
  });
});

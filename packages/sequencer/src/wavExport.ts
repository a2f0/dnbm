// Rendering the song to a WAV file offline, in a worker running the same engine.

import type { RenderReply, RenderRequest } from "@a2f0/dnbm-synth/audio/renderWorker";
import type { Song } from "@a2f0/dnbm-synth/song/model";

/**
 * Starts a module worker. Browsers only start workers from the page's origin, so a
 * script on another origin (assets served with CORS) loads through a same-origin shim.
 * `end` terminates the worker and frees the shim.
 */
function moduleWorker(url: URL): { readonly worker: Worker; end(): void } {
  if (url.origin === location.origin) {
    const worker = new Worker(url, { type: "module" });
    return { worker, end: () => worker.terminate() };
  }
  const shim = new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" });
  const shimUrl = URL.createObjectURL(shim);
  const worker = new Worker(shimUrl, { type: "module" });
  return {
    worker,
    end: () => {
      worker.terminate();
      URL.revokeObjectURL(shimUrl);
    },
  };
}

/** Where the export loads from, what it renders, and what it reports. */
export interface WavExport {
  /** The engine's WebAssembly module. */
  readonly engine: URL;
  /** The render worker's script. */
  readonly worker: URL;
  /** The song to render, read once the engine has loaded, as the worker starts. */
  song(): Song;
  /** Aborts when the app goes: the worker stops and the render rejects with its reason. */
  readonly signal: AbortSignal;
  /** Receives how much of the song has rendered, from 0 to 1. */
  onProgress(fraction: number): void;
}

/**
 * Renders the song to WAV bytes. Resolves undefined, starting no worker, when the app
 * went while the engine loaded; rejects with the signal's reason when it goes later.
 */
export async function renderWav({
  engine,
  worker: script,
  song,
  signal,
  onProgress,
}: WavExport): Promise<ArrayBuffer | undefined> {
  const wasm = await fetch(engine, { signal }).then((response) => response.arrayBuffer());
  // Gone while the engine loaded: start no worker, which an abort that already
  // happened would never stop.
  if (signal.aborted) return undefined;
  const { worker, end } = moduleWorker(script);
  const request: RenderRequest = { wasm, song: song(), sampleRate: 48_000 };
  let stop = () => {};
  return new Promise<ArrayBuffer>((resolve, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<RenderReply>) => {
      const reply = event.data;
      if (reply.type === "progress") onProgress(reply.fraction);
      else if (reply.type === "done") resolve(reply.wav);
      else reject(new Error(reply.message));
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage(request, [wasm]);
  }).finally(() => {
    signal.removeEventListener("abort", stop);
    end();
  });
}

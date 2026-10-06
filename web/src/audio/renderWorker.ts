// A worker that renders a song to a WAV file off the main thread, for "Export WAV".

import type { Song } from "../song/model";
import { renderSong } from "./offline";
import { WasmEngine } from "./wasmEngine";
import { encodeWav } from "./wav";

export interface RenderRequest {
  readonly wasm: ArrayBuffer;
  readonly song: Song;
  readonly sampleRate: number;
}

export type RenderReply =
  | { readonly type: "progress"; readonly fraction: number }
  | { readonly type: "done"; readonly wav: ArrayBuffer }
  | { readonly type: "error"; readonly message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderReply, transfer?: Transferable[]): void;
};

scope.onmessage = async (event) => {
  try {
    const { wasm, song, sampleRate } = event.data;
    const engine = await WasmEngine.create(wasm, sampleRate);
    const rendered = renderSong(engine, song, {
      onProgress: (fraction) => scope.postMessage({ type: "progress", fraction }),
    });
    const wav = encodeWav(rendered.left, rendered.right, rendered.sampleRate).buffer;
    scope.postMessage({ type: "done", wav }, [wav]);
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

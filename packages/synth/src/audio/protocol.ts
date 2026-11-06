// Messages between the page (engineHost.ts) and the AudioWorklet (worklet.ts).

import type { PlayMode } from "./wasmEngine";

export const PROCESSOR_NAME = "dnbm-engine";

// Each play and stop carries the host's next request number, and every position report
// the last one the engine took, so the host can tell reports sent before its latest
// play or stop (still in flight when it sent it) from the ones after.
export type HostMessage =
  | { readonly type: "init"; readonly wasm: ArrayBuffer }
  | { readonly type: "song"; readonly data: Float32Array }
  | {
      readonly type: "play";
      readonly mode: PlayMode;
      readonly index: number;
      readonly request: number;
    }
  | { readonly type: "cue"; readonly mode: PlayMode; readonly index: number }
  | { readonly type: "stop"; readonly request: number }
  | {
      readonly type: "trigger";
      readonly track: number;
      readonly velocity: number;
      readonly note: number;
    }
  | { readonly type: "release"; readonly track: number };

export type ProcessorMessage =
  | { readonly type: "ready" }
  | { readonly type: "error"; readonly message: string }
  | {
      readonly type: "position";
      readonly request: number;
      readonly slot: number;
      readonly pattern: number;
      readonly step: number;
      readonly playing: boolean;
    }
  | { readonly type: "meters"; readonly levels: Float32Array };

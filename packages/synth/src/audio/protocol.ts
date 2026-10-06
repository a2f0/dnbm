// Messages between the page (engineHost.ts) and the AudioWorklet (worklet.ts).

import type { PlayMode } from "./wasmEngine";

export const PROCESSOR_NAME = "dnbm-engine";

export type HostMessage =
  | { readonly type: "init"; readonly wasm: ArrayBuffer }
  | { readonly type: "song"; readonly data: Float32Array }
  | { readonly type: "play"; readonly mode: PlayMode; readonly index: number }
  | { readonly type: "cue"; readonly mode: PlayMode; readonly index: number }
  | { readonly type: "stop" }
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
      readonly slot: number;
      readonly pattern: number;
      readonly step: number;
      readonly playing: boolean;
    }
  | { readonly type: "meters"; readonly levels: Float32Array };

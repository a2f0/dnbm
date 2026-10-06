// Loads the built engine for tests; `bun run test` builds it first.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { WasmEngine } from "../src/audio/wasmEngine";

const WASM = join(import.meta.dir, "..", "..", "dist", "engine.wasm");

let bytes: ArrayBuffer | undefined;

export async function createEngine(sampleRate = 48_000): Promise<WasmEngine> {
  if (!existsSync(WASM))
    throw new Error("dist/engine.wasm is missing: run `bun run build:engine`.");
  bytes ??= await Bun.file(WASM).arrayBuffer();
  return WasmEngine.create(bytes, sampleRate);
}

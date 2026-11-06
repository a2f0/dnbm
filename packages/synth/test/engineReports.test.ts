// The engine's position reports and the host's play and stop requests: a report the
// worklet sent before it took the host's latest play or stop is stale, and the host drops
// it. Without that, `stop` then `play` in one task left the sequencer showing stopped
// while the song played, as the stop's report arrived after the play.

import { describe, expect, test } from "bun:test";
import { EngineHost, type PlayingPosition } from "../src/audio/engineHost";
import type { HostMessage, ProcessorMessage } from "../src/audio/protocol";
import { PlayMode } from "../src/audio/wasmEngine";
import { compileSong } from "../src/song/compile";
import { parseSong } from "../src/song/format";

const song = parseSong({
  dnbm: 1,
  bpm: 174,
  tracks: [{ id: "kick", instrument: "kick" }],
  patterns: [{ id: "a", rows: { kick: "X... X... X... X..." } }],
  arrangement: ["a"],
});

interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

/** The worklet's processor, registered against stand-ins for the AudioWorklet scope. */
async function processor(): Promise<{
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  sent: ProcessorMessage[];
}> {
  const sent: ProcessorMessage[] = [];
  let registered: (new () => unknown) | undefined;
  const scope = globalThis as Record<string, unknown>;
  scope["sampleRate"] = 48_000;
  scope["currentTime"] = 0;
  scope["AudioWorkletProcessor"] = class {
    readonly port: FakePort = {
      onmessage: null,
      postMessage: (message) => sent.push(message as ProcessorMessage),
    };
  };
  scope["registerProcessor"] = (_name: string, processor: new () => unknown) => {
    registered = processor;
  };
  await import("../src/audio/worklet");
  if (!registered) throw new Error("the worklet registered no processor");
  const instance = new registered() as {
    port: FakePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  };
  return Object.assign(instance, { sent });
}

const WASM = new URL("../../../dist/engine.wasm", import.meta.url);

describe("engine reports", () => {
  test("the worklet tags each position report with the last play or stop it took", async () => {
    const file = Bun.file(WASM);
    if (!(await file.exists()))
      throw new Error("dist/engine.wasm is missing: run `bun run build:engine`.");
    const worklet = await processor();
    const post = (message: HostMessage) => worklet.port.onmessage?.({ data: message });
    post({ type: "init", wasm: await file.arrayBuffer() });
    for (let tries = 0; !worklet.sent.some((message) => message.type === "ready"); tries++) {
      if (tries > 200) throw new Error(`the engine did not start: ${JSON.stringify(worklet.sent)}`);
      await Bun.sleep(5);
    }
    post({ type: "song", data: compileSong(song) });
    post({ type: "play", mode: PlayMode.Song, index: 0, request: 1 });
    const block = () => [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 4; i++) worklet.process([], [block()]);
    post({ type: "stop", request: 2 });
    post({ type: "play", mode: PlayMode.Song, index: 0, request: 3 });
    for (let i = 0; i < 4; i++) worklet.process([], [block()]);
    const reports = worklet.sent.flatMap((message) =>
      message.type === "position" ? [{ request: message.request, playing: message.playing }] : [],
    );
    expect(reports).toEqual([
      { request: 1, playing: true },
      { request: 2, playing: false },
      { request: 3, playing: true },
    ]);
  });

  test("the host drops reports from before its latest play or stop", () => {
    const posted: HostMessage[] = [];
    const port = {
      onmessage: null,
      postMessage: (message: HostMessage) => posted.push(message),
      close() {},
    };
    const context = { resume: () => Promise.resolve(), close: () => Promise.resolve() };
    // The constructor is private to `start`, which needs a real AudioContext.
    const Host = EngineHost as unknown as new (
      context: unknown,
      node: unknown,
      analyser: unknown,
      output: unknown,
    ) => EngineHost;
    const host = new Host(context, { port, disconnect() {} }, {}, {});
    const heard: PlayingPosition[] = [];
    host.onPosition = (position) => heard.push(position);
    const receive = (message: ProcessorMessage) =>
      (host as unknown as { receive(message: ProcessorMessage): void }).receive(message);
    const report = (request: number, playing: boolean): ProcessorMessage => ({
      type: "position",
      request,
      slot: 0,
      pattern: 0,
      step: 0,
      playing,
    });

    host.play(PlayMode.Song, 0);
    receive(report(1, true));
    // Stop and play again in one task, as a host's `run("stop"); run("play")` does.
    host.stop();
    host.play(PlayMode.Song, 0);
    // The engine's reports from before it took the stop, then the stop's own.
    receive(report(1, true));
    receive(report(2, false));
    receive(report(3, true));

    expect(posted.map((message) => ("request" in message ? message.request : undefined))).toEqual([
      1, 2, 3,
    ]);
    expect(heard.map(({ playing }) => playing)).toEqual([true, true]);
    expect(heard.every((position) => (position as { request?: number }).request !== 2)).toBe(true);
  });
});

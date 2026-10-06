// The page's side of the audio engine: starts an AudioContext, loads the worklet and
// the engine module into it, and relays songs, transport and audition commands. The
// sequencer and the player both drive the engine through it.

import { compileSong } from "../song/compile";
import type { Song } from "../song/model";
import { type HostMessage, PROCESSOR_NAME, type ProcessorMessage } from "./protocol";
import type { PlayMode } from "./wasmEngine";

export interface PlayingPosition {
  readonly slot: number;
  readonly pattern: number;
  readonly step: number;
  readonly playing: boolean;
}

export class EngineHost {
  onPosition: ((position: PlayingPosition) => void) | undefined;
  onMeters: ((levels: Float32Array) => void) | undefined;
  onError: ((message: string) => void) | undefined;

  private constructor(
    readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    /** Taps the master output for the scope and the spectrum, before the volume. */
    readonly analyser: AnalyserNode,
    private readonly output: GainNode,
  ) {}

  /** Starts the engine. Call from a user gesture, so the browser lets audio play. */
  static async start(wasmUrl = "engine.wasm", workletUrl = "worklet.js"): Promise<EngineHost> {
    const context = new AudioContext({ latencyHint: "interactive" });
    const [wasm] = await Promise.all([
      fetch(wasmUrl).then((response) => {
        if (!response.ok) throw new Error(`Couldn't load ${wasmUrl} (${response.status}).`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(workletUrl),
    ]);
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const output = context.createGain();
    node.connect(analyser);
    analyser.connect(output);
    output.connect(context.destination);

    const host = new EngineHost(context, node, analyser, output);
    await new Promise<void>((resolve, reject) => {
      node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
        const message = event.data;
        if (message.type === "ready") resolve();
        else if (message.type === "error") reject(new Error(message.message));
        host.receive(message);
      };
      host.send({ type: "init", wasm }, [wasm]);
    });
    return host;
  }

  private receive(message: ProcessorMessage): void {
    if (message.type === "position") this.onPosition?.(message);
    else if (message.type === "meters") this.onMeters?.(message.levels);
    else if (message.type === "error") this.onError?.(message.message);
  }

  private send(message: HostMessage, transfer: Transferable[] = []): void {
    this.node.port.postMessage(message, transfer);
  }

  loadSong(song: Song): void {
    const data = compileSong(song);
    this.send({ type: "song", data }, [data.buffer]);
  }

  /** Sets the output gain, from 0 for silence to 1 for the engine's full level. */
  setVolume(gain: number): void {
    // A short ramp, so dragging a volume control never zippers.
    this.output.gain.setTargetAtTime(
      Math.min(Math.max(gain, 0), 1),
      this.context.currentTime,
      0.01,
    );
  }

  play(mode: PlayMode, index: number): void {
    void this.context.resume();
    this.send({ type: "play", mode, index });
  }

  cue(mode: PlayMode, index: number): void {
    this.send({ type: "cue", mode, index });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  trigger(track: number, velocity: number, note: number): void {
    void this.context.resume();
    this.send({ type: "trigger", track, velocity, note });
  }

  release(track: number): void {
    this.send({ type: "release", track });
  }
}

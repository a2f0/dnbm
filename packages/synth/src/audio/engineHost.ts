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
  /** Once closed, every command does nothing. */
  private closed = false;

  private constructor(
    readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    /** Taps the master output for the scope and the spectrum, before the volume. */
    readonly analyser: AnalyserNode,
    private readonly output: GainNode,
  ) {}

  /**
   * Starts the engine from the engine module and the worklet script. Call from a user
   * gesture, so the browser lets audio play. Once `signal` aborts, during the start or
   * after it, the engine closes its audio context.
   */
  static async start(
    wasmUrl: string | URL,
    workletUrl: string | URL,
    signal?: AbortSignal,
  ): Promise<EngineHost> {
    signal?.throwIfAborted();
    const context = new AudioContext({ latencyHint: "interactive" });
    const abandon = () => void context.close().catch(() => {});
    signal?.addEventListener("abort", abandon, { once: true });
    try {
      const [wasm] = await Promise.all([
        fetch(wasmUrl, signal ? { signal } : {}).then((response) => {
          if (!response.ok) throw new Error(`Couldn't load ${wasmUrl} (${response.status}).`);
          return response.arrayBuffer();
        }),
        context.audioWorklet.addModule(workletUrl),
      ]);
      signal?.throwIfAborted();
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
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
          const message = event.data;
          if (message.type === "ready") resolve();
          else if (message.type === "error") reject(new Error(message.message));
          host.receive(message);
        };
        host.send({ type: "init", wasm }, [wasm]);
      });
      signal?.removeEventListener("abort", abandon);
      signal?.addEventListener("abort", () => host.close(), { once: true });
      return host;
    } catch (error) {
      abandon();
      throw error;
    }
  }

  /** Stops the engine for good: closes its port and its audio context. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onPosition = undefined;
    this.onMeters = undefined;
    this.onError = undefined;
    this.node.port.onmessage = null;
    this.node.port.close();
    this.node.disconnect();
    void this.context.close().catch(() => {});
  }

  private receive(message: ProcessorMessage): void {
    if (message.type === "position") this.onPosition?.(message);
    else if (message.type === "meters") this.onMeters?.(message.levels);
    else if (message.type === "error") this.onError?.(message.message);
  }

  private send(message: HostMessage, transfer: Transferable[] = []): void {
    if (!this.closed) this.node.port.postMessage(message, transfer);
  }

  /** Resumes the audio context, as starting playback must; a closed engine stays shut. */
  private resume(): void {
    if (!this.closed) this.context.resume().catch(() => {});
  }

  loadSong(song: Song): void {
    const data = compileSong(song);
    this.send({ type: "song", data }, [data.buffer]);
  }

  /** Sets the output gain, from 0 for silence to 1 for the engine's full level. */
  setVolume(gain: number): void {
    if (this.closed) return;
    // A short ramp, so dragging a volume control never zippers.
    this.output.gain.setTargetAtTime(
      Math.min(Math.max(gain, 0), 1),
      this.context.currentTime,
      0.01,
    );
  }

  play(mode: PlayMode, index: number): void {
    this.resume();
    this.send({ type: "play", mode, index });
  }

  cue(mode: PlayMode, index: number): void {
    this.send({ type: "cue", mode, index });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  trigger(track: number, velocity: number, note: number): void {
    this.resume();
    this.send({ type: "trigger", track, velocity, note });
  }

  release(track: number): void {
    this.send({ type: "release", track });
  }
}

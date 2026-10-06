// The AudioWorklet processor: runs the engine on the audio thread, one render quantum
// at a time, and reports the playing step and meter levels back to the page.

import { type HostMessage, PROCESSOR_NAME, type ProcessorMessage } from "./protocol";
import { WasmEngine } from "./wasmEngine";

// The AudioWorkletGlobalScope isn't in TypeScript's DOM library.
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** How often meter levels go to the page. */
const METER_SECONDS = 1 / 30;

class EngineProcessor extends AudioWorkletProcessor {
  private engine: WasmEngine | undefined;
  /** Messages that arrive while the module is still compiling. */
  private readonly pending: HostMessage[] = [];
  private serial = 0;
  private playing = false;
  private nextMeters = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<HostMessage>) => this.receive(event.data);
  }

  private send(message: ProcessorMessage, transfer: Transferable[] = []): void {
    this.port.postMessage(message, transfer);
  }

  private receive(message: HostMessage): void {
    if (message.type === "init") {
      WasmEngine.create(message.wasm, sampleRate).then(
        (engine) => {
          this.engine = engine;
          for (const queued of this.pending.splice(0)) this.apply(engine, queued);
          this.send({ type: "ready" });
        },
        (error: unknown) => this.send({ type: "error", message: String(error) }),
      );
    } else if (this.engine) {
      this.apply(this.engine, message);
    } else {
      this.pending.push(message);
    }
  }

  private apply(engine: WasmEngine, message: HostMessage): void {
    try {
      switch (message.type) {
        case "song":
          engine.loadSong(message.data);
          break;
        case "play":
          engine.play(message.mode, message.index);
          break;
        case "cue":
          engine.cue(message.mode, message.index);
          break;
        case "stop":
          engine.stop();
          this.report(engine);
          break;
        case "trigger":
          engine.trigger(message.track, message.velocity, message.note);
          break;
        case "release":
          engine.release(message.track);
          break;
        case "init":
          break;
      }
    } catch (error) {
      this.send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private report(engine: WasmEngine): void {
    const position = engine.position();
    this.serial = position.serial;
    this.playing = position.playing;
    this.send({
      type: "position",
      slot: position.slot,
      pattern: position.pattern,
      step: position.step,
      playing: position.playing,
    });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const engine = this.engine;
    const [left, right] = outputs[0] ?? [];
    if (!engine || !left) return true;

    const rendered = engine.render(left.length);
    left.set(rendered.left);
    right?.set(rendered.right);

    if (engine.serial() !== this.serial || (this.playing && !engine.position().playing)) {
      this.report(engine);
    }
    if (currentTime >= this.nextMeters) {
      this.nextMeters = currentTime + METER_SECONDS;
      const levels = engine.meters().slice();
      engine.resetMeters();
      this.send({ type: "meters", levels }, [levels.buffer]);
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, EngineProcessor);

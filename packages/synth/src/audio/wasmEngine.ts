// A typed wrapper around the engine's WebAssembly exports (packages/synth/engine/src/lib.rs). The
// AudioWorklet, the export worker, scripts/render.ts and the tests all drive the
// engine through it. It uses nothing an AudioWorkletGlobalScope lacks.

interface EngineExports {
  readonly memory: WebAssembly.Memory;
  engine_new(sampleRate: number): number;
  engine_free(engine: number): void;
  engine_song_buffer(engine: number, length: number): number;
  engine_load_song(engine: number): number;
  engine_play(engine: number, mode: number, index: number): void;
  engine_cue(engine: number, mode: number, index: number): void;
  engine_stop(engine: number): void;
  engine_trigger(engine: number, track: number, velocity: number, note: number): void;
  engine_release(engine: number, track: number): void;
  engine_render(engine: number, frames: number): number;
  engine_output(engine: number, channel: number): number;
  engine_playing(engine: number): number;
  engine_position_serial(engine: number): number;
  engine_position_slot(engine: number): number;
  engine_position_pattern(engine: number): number;
  engine_position_step(engine: number): number;
  engine_meters(engine: number): number;
  engine_reset_meters(engine: number): void;
  engine_meter_count(): number;
  engine_max_frames(): number;
  engine_describe(): number;
  engine_describe_length(): number;
}

/** Play the arrangement from a slot, or loop one pattern. */
export const PlayMode = { Song: 0, Pattern: 1 } as const;
export type PlayMode = (typeof PlayMode)[keyof typeof PlayMode];

const SONG_ERRORS: Readonly<Record<number, string>> = {
  [-1]: "the data ends early",
  [-2]: "the header is wrong",
  [-3]: "an instrument is unknown",
  [-4]: "a count is out of range",
  [-5]: "a pattern is malformed",
  [-6]: "the arrangement names a missing pattern",
  [-7]: "there is data after the end",
};

export interface Position {
  /** Counts every step fired; changes when the rest does. */
  readonly serial: number;
  readonly slot: number;
  readonly pattern: number;
  readonly step: number;
  readonly playing: boolean;
}

export class WasmEngine {
  readonly maxFrames: number;
  readonly meterCount: number;
  private views:
    | { buffer: ArrayBuffer; left: Float32Array; right: Float32Array; meters: Float32Array }
    | undefined;

  private constructor(
    private readonly exports: EngineExports,
    private readonly pointer: number,
    readonly sampleRate: number,
  ) {
    this.maxFrames = exports.engine_max_frames();
    this.meterCount = exports.engine_meter_count();
  }

  /** Instantiates the module (bytes or compiled) and creates an engine. */
  static async create(
    source: BufferSource | WebAssembly.Module,
    sampleRate: number,
  ): Promise<WasmEngine> {
    const module =
      source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
    const instance = await WebAssembly.instantiate(module, {});
    const exports = instance.exports as unknown as EngineExports;
    return new WasmEngine(exports, exports.engine_new(sampleRate), sampleRate);
  }

  /**
   * Views into the engine's buffers. Memory can grow when a song loads, which detaches
   * old views, so they are rebuilt whenever the buffer changes.
   */
  private buffers() {
    const { buffer } = this.exports.memory;
    if (this.views?.buffer !== buffer) {
      const e = this.exports;
      const p = this.pointer;
      this.views = {
        buffer,
        left: new Float32Array(buffer, e.engine_output(p, 0), this.maxFrames),
        right: new Float32Array(buffer, e.engine_output(p, 1), this.maxFrames),
        meters: new Float32Array(buffer, e.engine_meters(p), this.meterCount),
      };
    }
    return this.views;
  }

  /** Loads a compiled song (see song/compile.ts); playback continues where it was. */
  loadSong(data: Float32Array): void {
    const address = this.exports.engine_song_buffer(this.pointer, data.length);
    new Float32Array(this.exports.memory.buffer, address, data.length).set(data);
    const code = this.exports.engine_load_song(this.pointer);
    if (code !== 0) {
      throw new Error(`The engine refused the song: ${SONG_ERRORS[code] ?? `error ${code}`}.`);
    }
  }

  play(mode: PlayMode, index: number): void {
    this.exports.engine_play(this.pointer, mode, index);
  }

  cue(mode: PlayMode, index: number): void {
    this.exports.engine_cue(this.pointer, mode, index);
  }

  stop(): void {
    this.exports.engine_stop(this.pointer);
  }

  trigger(track: number, velocity: number, note: number): void {
    this.exports.engine_trigger(this.pointer, track, velocity, note);
  }

  release(track: number): void {
    this.exports.engine_release(this.pointer, track);
  }

  /**
   * Renders up to `maxFrames` frames. The returned views are only valid until the
   * next call into the engine.
   */
  render(frames: number): { left: Float32Array; right: Float32Array; frames: number } {
    const rendered = this.exports.engine_render(this.pointer, frames);
    const { left, right } = this.buffers();
    return {
      left: left.subarray(0, rendered),
      right: right.subarray(0, rendered),
      frames: rendered,
    };
  }

  position(): Position {
    const e = this.exports;
    const p = this.pointer;
    return {
      serial: e.engine_position_serial(p),
      slot: e.engine_position_slot(p),
      pattern: e.engine_position_pattern(p),
      step: e.engine_position_step(p),
      playing: e.engine_playing(p) === 1,
    };
  }

  serial(): number {
    return this.exports.engine_position_serial(this.pointer);
  }

  /** Peak levels since the last reset: per track, then master left and right. */
  meters(): Float32Array {
    return this.buffers().meters;
  }

  resetMeters(): void {
    this.exports.engine_reset_meters(this.pointer);
  }

  /** The engine's version and parameter order, as `version=1;kick=tune,...`. */
  describe(): string {
    const e = this.exports;
    const bytes = new Uint8Array(e.memory.buffer, e.engine_describe(), e.engine_describe_length());
    return new TextDecoder().decode(bytes);
  }

  free(): void {
    this.exports.engine_free(this.pointer);
  }
}

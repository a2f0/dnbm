# Architecture

```text
 web/src/ui/*  ──edits──▶  SongStore  ──compileSong──▶  Float32Array
     ▲                       │                              │ postMessage
     │ position, meters      │ autosave, files              ▼
 EngineHost  ◀──────────────────────────────────  worklet.ts (AudioWorklet)
                                                       │ WasmEngine
                                                       ▼
                                                 engine.wasm (Rust)
```

## The engine (`engine/`)

A Rust crate compiled to `wasm32-unknown-unknown` with no imports and no generated
glue: `src/lib.rs` exports a C ABI of numbers and pointers into linear memory, and
`web/src/audio/wasmEngine.ts` wraps it. `scripts/build.ts` builds it, runs `wasm-opt`,
and fails if the module imports anything.

- **Sequencer** (`engine.rs`). Steps fire on the first sample at or after their time,
  tracked in fractional samples so tempo never drifts. A render call splits at step
  boundaries, so output is identical whatever the block size: 128-frame worklet quanta,
  4096-frame offline blocks, or anything else. Swing stretches even sixteenths and
  shrinks odd ones by the same amount.
- **Instruments** (`instruments/`). All synthesized. Percussive tracks alternate between
  two voices, so a retrigger fades the last hit out over 5 ms instead of clicking.
  Melodic tracks are monophonic; a note played over a held note glides to it.
- **Mixer** (`mixer.rs`). Per track: a high-pass and low-pass (Simper trapezoidal SVFs),
  `tanh` drive, a constant-power pan, and post-fader reverb and delay sends. Gains ramp
  per block, so moving a control never zippers.
- **Effects** (`dsp/`). An eight-line feedback delay network reverb with damping in the
  loop, a tempo-synced ping-pong delay, a soft-knee bus compressor, and a `tanh` clipper,
  so output never exceeds full scale.
- **Determinism.** Noise comes from seeded xorshift generators and every start phase is
  fixed, so a song renders to identical samples every time. A voice stops on the exact
  sample it falls silent, so the state its next trigger starts from never depends on
  where a block boundary fell. `web/test/engine.test.ts` and the instrument tests check
  both.

## Songs into the engine

The editor holds a `Song` (`web/src/song/model.ts`). `compileSong` flattens it into a
`Float32Array` whose layout is documented in `engine/src/song.rs`; the engine checks
every count, clamps every value, and keeps its old song if the new one is malformed.
A song loads between render quanta without stopping playback or cutting voices, so
editing while playing is seamless. The UI coalesces edits to one load per animation
frame.

Instrument parameters are positional in the compiled song. `engine_describe` reports
the engine's order, and a test compares it with `web/src/song/instruments.ts`.

## The page (`web/`)

Plain TypeScript and DOM, bundled by `Bun.build` into three files: the page
(`main.ts`), the worklet (`audio/worklet.ts`) and the WAV export worker
(`audio/renderWorker.ts`). The AudioContext starts on the first gesture, as browsers
require. The worklet receives the engine's bytes, instantiates them, and reports the
playing step and meter peaks back to the page.

`SongStore` keeps undo history; every edit is normalized exactly as saving would
normalize it, so the screen, the sound and the saved file always agree. The song
autosaves to local storage; files open and save through the File System Access API
where available, and through file inputs and downloads elsewhere.

## Adding an instrument

1. Add the voice in `engine/src/instruments/`, a variant to `InstrumentKind` and
   `Voice`, and its parameter names in order.
2. Add the same parameters, in the same order, with ranges and defaults, to
   `INSTRUMENTS` in `web/src/song/instruments.ts`.
3. Run `bun run check`. The engine description test fails until the two agree, and the
   level test in `instruments/mod.rs` keeps every instrument at a sane loudness.

## Look

Every colour is a grey: `web/test/grayscale.test.ts` refuses any colour whose red,
green and blue differ. Brightness carries meaning: brighter is louder, selected, or
playing.

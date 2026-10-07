# Architecture

Three workspace packages under `packages/`. `synth` is everything that makes sound and
everything that reads songs; the two apps, `sequencer` and `player`, build on it and
never import each other. `scripts/build.ts` bundles the synth into each app, so the
packages are private and only the root's `@a2f0/dnbm` is published, with its
entrypoints in `src/`.

## Mounting

Every app runs inside a page that may hold other things: a host's mini-app window, or
the site's own page. `src/shell.ts` mounts it the same way in both. It appends an
element to the host's container, attaches an open shadow root, loads the app's
stylesheet into the root and, in parallel, imports the app module from the assets
URL, then calls the module's `mount(root, context)`. `mountDnbm` and
`mountDnbmPlayer` (`src/index.ts`) are thin wrappers over it, and each site page's
script (`main.ts`) mounts its app through it too, from the assets beside the page.

The app module (`mount.ts`, built to `mount.js` and `player/mount.js`) renders only
inside its root. Its frame (`.frame`) scrolls the app, sizes the layout's container
queries as a frame's window once did, and takes focus on a press anywhere in the app,
so its shortcuts listen there and hear only their own keys. Presses go on as usual
(nothing cancels a `pointerdown`), so the host hears them too. Dialogs open in the root
over the app. URLs resolve from `context.assets`, and the page title goes through
`context.onTitle`, which only the site's own page passes. When `context.signal`
aborts, on `destroy()` or a failure to start, the app closes its audio context and
releases its worker, timers, animation frames and window listener; the shell removes
the element. The module has no state of its own beyond its code, so any number of
apps can share a page.

A host drives the app through its instance as well as through presses. The module
returns a control whose `run(command)` calls the same method the command's button or
shortcut does, and publishes the app's state (`DnbmSequencerState` or
`DnbmPlayerState` in `src/control.ts`) through `context.onState` from its `render`,
and the sequencer also as a dialog opens or closes. The shell keeps that state in a
`StateChannel`: it holds it back until `ready`, freezes a snapshot only when
something changed, tells subscribers in a microtask, and on `destroy()` returns to
the idle state and drops every subscriber before the app lets go. `run` reaches the
app only between `ready` and `destroy()`. With `actions: false`, the apps leave out
their buttons for those commands, for a host that shows them in its own chrome.

The shell gives the element `all: initial` inline, which outranks the host page's
rules for it, so nothing the host sets is inherited into the app; the app's top-level
elements define its palette (custom properties outlast `all`) and set its type and
colours, and no rule of the app's reaches the host. Work
that outlives the app, such as a file picker still open when it is destroyed, writes
nothing to storage once its signal has aborted.

| Package | Holds |
| --- | --- |
| `synth` (`@a2f0/dnbm-synth`) | The Rust engine (`engine/`), its AudioWorklet host, offline render and WAV export (`src/audio/`), and the song model, format, schema and compiler (`src/song/`) |
| `sequencer` | The editor: the song store and its panels |
| `player` | A playlist, a display and transport controls over a list of songs |

```text
  sequencer UI ──edits──▶  SongStore  ──compileSong──▶  Float32Array
     ▲                       │                              │ postMessage
     │ position, meters      │ autosave, files              ▼
 EngineHost  ◀──────────────────────────────────  worklet.ts (AudioWorklet)
                                                       │ WasmEngine
                                                       ▼
                                                 engine.wasm (Rust)
```

## The engine (`packages/synth/engine/`)

A Rust crate compiled to `wasm32-unknown-unknown` with no imports and no generated
glue: `src/lib.rs` exports a C ABI of numbers and pointers into linear memory, and
`packages/synth/src/audio/wasmEngine.ts` wraps it. `scripts/build.ts` builds it, runs
`wasm-opt`, and fails if the module imports anything.

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
  where a block boundary fell. `packages/synth/test/engine.test.ts` and the instrument
  tests check both.

## Songs into the engine

The editor holds a `Song` (`packages/synth/src/song/model.ts`). `compileSong` flattens it into a
`Float32Array` whose layout is documented in `packages/synth/engine/src/song.rs`; the engine checks
every count, clamps every value, and keeps its old song if the new one is malformed.
A song loads between render quanta without stopping playback or cutting voices, so
editing while playing is seamless. The UI coalesces edits to one load per animation
frame.

Instrument parameters are positional in the compiled song. `engine_describe` reports
the engine's order, and a test compares it with `packages/synth/src/song/instruments.ts`.

## The sequencer (`packages/sequencer/`)

Plain TypeScript and DOM, bundled by `Bun.build` into four files: the app module
(`mount.ts`), the page's script (`main.ts`), and from the synth, the worklet
(`audio/worklet.ts`) and the WAV export worker (`audio/renderWorker.ts`). The
AudioContext starts on the first gesture, as browsers require. The worklet receives the engine's bytes, instantiates them, and reports the
playing step and meter peaks back to the page.

`SongStore` keeps undo history; every edit is normalized exactly as saving would
normalize it, so the screen, the sound and the saved file always agree. The song
autosaves to local storage; files open and save through the File System Access API
where available, and through file inputs and downloads elsewhere.

## The player (`packages/player/`)

`Player` takes an array of songs and plays them in order, shuffled, or repeating,
through the same `EngineHost`, worklet and engine module as the sequencer. The build
writes it to `player/` in the site, beside the sequencer, and it loads the engine, the
worklet and the example songs from the assets' root.

The engine reports the playing arrangement slot and step; `timeline.ts` turns those
into seconds, and turns a seek back into the slot it falls in, so seeking lands on a
slot boundary. It plays in the engine's `SongOnce` mode, which stops on the sample the
step after the last would fire, so the last step plays out in full; the player then
lets the reverb and delay ring out and starts the next song. Pause suspends the
AudioContext, which stops the engine mid-step and resumes it exactly there, and holds
what is left of a ring-out.

## Adding an instrument

1. Add the voice in `packages/synth/engine/src/instruments/`, a variant to `InstrumentKind` and
   `Voice`, and its parameter names in order.
2. Add the same parameters, in the same order, with ranges and defaults, to
   `INSTRUMENTS` in `packages/synth/src/song/instruments.ts`.
3. Run `bun run check`. The engine description test fails until the two agree, and the
   level test in `instruments/mod.rs` keeps every instrument at a sane loudness.

## Look

Every colour is a grey: `test/grayscale.test.ts` refuses any colour whose red,
green and blue differ. Brightness carries meaning: brighter is louder, selected, or
playing.

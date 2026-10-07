# dnbm

A dark drum and bass sequencer and mixer in the browser, at
[dnbm.a2f0.net](https://dnbm.a2f0.net). Program patterns on a step grid, arrange them
into a song, mix them with per-track filters, drive and sends, and save songs as plain
text that diffs and merges cleanly in Git.

The sound comes from a Rust engine compiled to WebAssembly and run in an AudioWorklet.
Every drum and bass sound is synthesized, not sampled; steps land on the exact sample
they fall on; and the same engine renders WAV files offline. A song sounds the same in
the browser, in an export and from the command line.

## Run it

```sh
mise install                      # Bun, ShellCheck and wasm-opt (see .mise.toml)
bun install
sh scripts/git/install-hooks.sh   # once per clone
bun run dev                       # http://localhost:8174
```

Rust comes from [rustup](https://rustup.rs), which installs the toolchain and
WebAssembly target pinned in `rust-toolchain.toml` on first use.

The editor opens on **Undertow**, a 172 BPM roller in F minor: syncopated sub and
reese bass, dry backbeats, ghost snares and sparse, filtered dub echoes. Its 36 bars
move from a short intro through four-bar variations, a half-time break and a heavier
return. Press space to play. The browser restores your last session; choose
Undertow from **examples** to reload the bundled song. The same menu holds ten
darker songs, from Bathyal's slow pressure and Oubliette's bare cell to Corrosion's
industrial grind and Sever's techstep cuts, each longer than Undertow and all built
from the same synthesized kit: drones and stabs come from the `pad` instrument,
detuned saw pairs an interval apart under a slow, resonant filter.

Click an arrangement slot to start there, or choose **loop** to work on one pattern.
**follow** keeps the grid on the playing pattern; selecting another pattern during
song playback turns follow off so you can edit ahead. Muted channels and channels
excluded by solo dim in the mixer. The master holds its highest peak in dBFS; click
that reading to reset it, or start playback for a fresh reading.

## Player

[dnbm.a2f0.net/player/](https://dnbm.a2f0.net/player/) plays the example songs as a
playlist, after the desktop players of old: elapsed or remaining time, a spectrum,
seek, shuffle, repeat and volume, with Z, X, C, V and B for previous, play, pause, stop
and next. It plays through the same engine as the editor and edits nothing. Other pages
embed it with `mountDnbmPlayer` from the package, passing any list of song files as
the playlist.

## Songs

Songs are `.dnbm.json` files. Each pattern row is one line, so changing a step changes
one line of the file:

```json
"rows": {
  "kick": "X... .... ..X. .... | ..X. .... ..X. ....",
  "snare": ".... X... .... X... | .... X... .... X...",
  "reese": "F-1 --- --- ---  --- --- ... F-1  --- ... F-1 ---  F#1 --- --- ... | ..."
}
```

In Chromium, Save writes back to the file you opened, so a song in a Git checkout can
be edited, saved and committed in place. [The song format](docs/song-format.md)
describes every field.

```sh
bun run render songs/undertow.dnbm.json   # render to undertow.wav (24-bit, 48 kHz)
bun run songs:fmt                         # rewrite songs/ canonically
bun run songs:check                       # fail on an invalid or non-canonical song
```

## Package

dnbm is also published to npm as [`@a2f0/dnbm`](https://www.npmjs.com/package/@a2f0/dnbm),
to embed the whole app in another page or app, such as a mini-app window:

```ts
import { copyDnbmAssets } from "@a2f0/dnbm/build";   // in a build script
await copyDnbmAssets("./public/dnbm");

import { mountDnbm } from "@a2f0/dnbm";              // in the browser
const dnbm = mountDnbm(container, { assetsUrl: "/dnbm/" });
await dnbm.ready;                                     // it shows

import { mountDnbmPlayer } from "@a2f0/dnbm";        // or just the player
const player = mountDnbmPlayer(container, { assetsUrl: "/dnbm/", songs });
```

The app renders in the host's own document, inside a shadow root that keeps its styles
and the host's apart, and takes only the keys pressed inside it.
[The package guide](docs/package.md) covers embedding and releases.

## Layout

| Path | What |
| --- | --- |
| `packages/synth/` | The shared synthesizer: the Rust audio engine (`engine/`), its AudioWorklet host, and the song format |
| `packages/sequencer/` | The editor and mixer (TypeScript and DOM) |
| `src/` | The npm package's entrypoints (`mountDnbm`, `mountDnbmPlayer`, `copyDnbmAssets`), and the shell that mounts an app into a shadow root |
| `packages/player/` | A playlist player that plays songs through the same synthesizer |
| `test/` | Repository-wide tests: the packed npm package, and the greys-only rule |
| `songs/` | Example songs |
| `scripts/` | Build, dev server, WAV render, song formatter, git hooks and checks |
| `docs/` | [Song format](docs/song-format.md), [architecture](docs/architecture.md), [package](docs/package.md), [deploying](docs/deploying.md) |

## Development

```sh
bun run check   # everything CI checks; the pre-push hook runs it too; needs Google Chrome
bun run test    # build the engine, then the TypeScript tests
bun run engine:check   # rustfmt, clippy and cargo test
bun run fix     # format TypeScript, Rust and songs
```

Coding agents follow [`AGENTS.md`](AGENTS.md).

# dnbm

A dark drum and bass sequencer and mixer in the browser. Program patterns on a step
grid, arrange them into a song, mix them with per-track filters, drive and sends, and
save songs as plain text that diffs and merges cleanly in Git.
This repo is available on the web at <https://dnbm.a2f0.net>. Its player, at
<https://dnbm.a2f0.net/player/>, plays the example songs as a playlist.

The sound comes from a Rust engine compiled to WebAssembly and run in an AudioWorklet.
Every drum and bass sound is synthesized, not sampled; steps land on the exact sample
they fall on; and the same engine renders WAV files offline. A song sounds the same in
the browser, in an export and from the command line.

The standalone site uses [CT click tracking](docs/click-tracking.md). Embedded apps
leave tracking to their host.

## Quick start

Install [mise](https://mise.jdx.dev/) and [rustup](https://rustup.rs); rustup installs
the toolchain and WebAssembly target pinned in `rust-toolchain.toml` on first use.

```sh
mise install                      # Bun, Node, ShellCheck and wasm-opt (see .mise.toml)
bun install
bun run hooks:install             # once per clone
bun run dev                       # http://localhost:8174 (player: /player/)
```

The editor opens on the example song Undertow; press space to play.

## Layout

| Path                  | What                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `packages/sequencer/` | [The editor and mixer](packages/sequencer/README.md), served at the site's root    |
| `packages/player/`    | [The playlist player](packages/player/README.md), served at `/player/`             |
| `packages/synth/`     | The shared synthesizer: the Rust engine, its AudioWorklet host and the song format |
| `src/`                | The entrypoints of the `@a2f0/dnbm` package                                        |
| `songs/`              | The example songs                                                                  |

[Architecture](docs/architecture.md) describes how the packages fit together.

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

The example songs in `songs/` open from the editor's **examples** menu, and the player
plays them all. **Undertow** is a 172 BPM roller in F minor: syncopated sub and reese
bass, dry backbeats, ghost snares and sparse, filtered dub echoes. Its 36 bars move from
a short intro through four-bar variations, a half-time break and a heavier return. Ten
darker songs, from Bathyal's slow pressure and Oubliette's bare cell to Corrosion's
industrial grind and Sever's techstep cuts, are each longer than Undertow and all built
from the same synthesized kit: drones and stabs come from the `pad` instrument, detuned
saw pairs an interval apart under a slow, resonant filter.

## Package

dnbm is also published to npm as [`@a2f0/dnbm`](https://www.npmjs.com/package/@a2f0/dnbm),
to embed the whole app in another page or app, such as a mini-app window:

```ts
import { copyDnbmAssets } from "@a2f0/dnbm/build"; // in a build script
await copyDnbmAssets("./public/dnbm");

import { mountDnbm } from "@a2f0/dnbm"; // in the browser
const dnbm = mountDnbm(container, { assetsUrl: "/dnbm/" });
await dnbm.ready; // it shows

import { mountDnbmPlayer } from "@a2f0/dnbm"; // or just the player
const player = mountDnbmPlayer(container, { assetsUrl: "/dnbm/", songs });
```

The app renders in the host's own document, inside a shadow root that keeps its styles
and the host's apart, and takes only the keys pressed inside it. A host's own
controls, such as a window's menus and toolbar, can drive it: each instance runs
commands (`dnbm.run("save")`), reports its state (playing, the song's title, unsaved
changes, which commands are available) and tells subscribers when it changes, and
`actions: false` leaves out the app's own buttons for those commands.
[The package guide](docs/package.md) covers embedding and releases.

## Development

```sh
bun run check   # everything CI checks; the pre-push hook runs it too; needs Google Chrome
bun run test    # build the engine, then the TypeScript tests
bun run engine:check   # rustfmt, clippy and cargo test
bun run fix     # format TypeScript, Rust and songs
```

See [development](docs/development.md) for layout, script ownership and validation,
[package releases](docs/package.md#releases) for publishing, and
[dependency maintenance](docs/dependency-upgrades.md) for upgrade procedures
and active constraints.

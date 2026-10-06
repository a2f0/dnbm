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

The editor opens on **Undertow**, an example song in `songs/`. Press space to play.

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

## Layout

| Path | What |
| --- | --- |
| `engine/` | The audio engine in Rust: sequencer, instruments, mixer, effects |
| `web/` | The editor (TypeScript and DOM), the AudioWorklet, and the song format |
| `songs/` | Example songs |
| `scripts/` | Build, dev server, WAV render, song formatter, git hooks and checks |
| `docs/` | [Song format](docs/song-format.md), [architecture](docs/architecture.md), [deploying](docs/deploying.md) |

## Development

```sh
bun run check   # everything CI checks; the pre-push hook runs it too
bun run test    # build the engine, then the TypeScript tests
bun run engine:check   # rustfmt, clippy and cargo test
bun run fix     # format TypeScript, Rust and songs
```

Coding agents follow [`AGENTS.md`](AGENTS.md).

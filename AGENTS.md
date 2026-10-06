# dnbm

A dark drum and bass sequencer and mixer in the browser, hosted at dnbm.a2f0.net and
published to npm as `@a2f0/dnbm` for embedding (for example in a2f0.net's experiment
mini-apps). It is a Bun workspaces monorepo with three packages, TypeScript and DOM with
no framework:

- `packages/synth/`: the shared synthesizer. The Rust audio engine compiled to
  WebAssembly (`engine/`), its AudioWorklet host (`src/audio/`), and the song format
  (`src/song/`). Imported as `@a2f0/dnbm-synth/audio/*` and `@a2f0/dnbm-synth/song/*`.
- `packages/sequencer/`: the editor and mixer, served at the site's root.
- `packages/player/`: a playlist player for listening, served at `/player/`. It takes an
  array of songs and edits nothing.

The workspace packages are private; the root `package.json` is the published
`@a2f0/dnbm`, whose two entrypoints are in `src/`, and the build bundles the synth into
each app. `README.md` gives the
overview and `docs/` the detail: [song format](docs/song-format.md),
[architecture](docs/architecture.md), [package](docs/package.md),
[deploying](docs/deploying.md).

## Setup

```sh
mise install && bun install
sh scripts/git/install-hooks.sh
```

Rust comes from rustup, which installs the toolchain in `rust-toolchain.toml`.

## Validation

`bun run check` (`scripts/checks/checkAll.sh`) is the full local gate; the pre-push
hook runs it, and CI runs the same checks. The package test embeds the packed app in a
cross-origin frame in Google Chrome (through `playwright-core`), so checks need Chrome
installed, as GitHub's runners have. While iterating:

```sh
bun run engine:check                 # rustfmt, clippy -D warnings, cargo test
bun run test                         # build the engine, then bun test
bun run typecheck && bunx biome ci   # TypeScript and Biome
bun run songs:check                  # songs are valid and canonical
bun run lint:binary-files            # no binary files since upstream (or pass --staged, --all)
bun run build:package                # the npm package, into lib/ and site/
bun run dev                          # http://localhost:8174 (player: /player/), rebuilding
```

Check UI changes in a browser as well as in tests. `bun run render <song>` renders a
song with the same engine, for checking sound changes offline.

## Conventions

- Branches: `<type>/<name>`, e.g. `feat/clap-voice`. Commits and PR titles: Conventional
  Commits, at most 50 characters, lowercase subject. Commits are signed and carry no
  `Co-authored-by` trailers; the hooks reject both.
- No binary files in Git (`scripts/checks/checkBinaryFiles.sh`). Every sound is
  synthesized; there are no samples to commit.
- Every colour is a grey with equal red, green and blue (`test/grayscale.test.ts`).
- The app runs embedded in other pages (`@a2f0/dnbm`), so don't use `window.confirm`,
  `prompt` or `alert`, which browsers block in cross-origin frames: use
  `packages/sequencer/src/ui/dialog.ts`. Anything a frame may refuse needs a fallback.
- The sound is dark: minor keys, low filter cutoffs and dark reverb by default. Keep new
  defaults and example songs in that spirit.
- Songs are canonical (`bun run songs:fmt`). Never hand-format a `.dnbm.json` file, and
  never add volatile data (timestamps, random ids) to the format.
- Instrument parameters are positional between
  `packages/synth/engine/src/instruments/mod.rs` and
  `packages/synth/src/song/instruments.ts`; change both together (see "Adding an
  instrument" in `docs/architecture.md`). Adding an instrument kind is additive and keeps
  the format version, since every earlier song still reads the same way; a change to
  existing fields bumps `FORMAT_VERSION` and needs a migration.
- The engine is deterministic and its output never exceeds full scale; tests check both.
  Keep noise seeded, and keep the render path free of allocation (only song loads allocate).
- Code both apps need belongs in `packages/synth`; the apps never import each other.
- `tsconfig.json` extends `@tsconfig/strictest`; index-signature access uses brackets
  (`record["key"]`), so Biome's `useLiteralKeys` is off.

## Shipping

PR workflows come from the `@a2f0/agent-tool` dev dependency: use `open-pr` to open a
PR and `ship-pr` to ship one end to end (independent review, repairs, merge, cleanup).
Run them with `bun run agent-tool ...`. Do not edit the managed skill copies in
`.agents/skills` and `.claude/skills`; after upgrading the dependency, run
`bun run agents:sync` and commit the dependency, lockfile, skills and
`.agent-tool-skills.json` together. The required check is `CI gate` (see
`agent-tool.json`).

The root package is versioned (`versions` in `agent-tool.json`): each shipped PR carries
`package.json` one patch past the pinned base, and a deliberate minor or major bump is
kept. Run `bun run agent-tool versions prepare <pinned-base-sha>` after every integration
or repair and before each review; it commits the bump as `chore: bump package versions`.
Each merge that raises the version publishes `@a2f0/dnbm` to npm through
`.github/workflows/npm-publish.yml`; verify that run and the npm version after merging,
and report a failed publish separately from the merge. The package's public API is
`mountDnbm`, `mountDnbmPlayer` and `copyDnbmAssets`; keep it backward compatible or bump
the minor version.

Merging deploys only once the `DNBM_DEPLOY` repository variable is set; until then,
`bun run deploy` publishes by hand (see `docs/deploying.md`).

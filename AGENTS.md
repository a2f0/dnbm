# dnbm

A dark drum and bass sequencer and mixer in the browser, hosted at dnbm.a2f0.net. The
audio engine is Rust compiled to WebAssembly (`engine/`); the editor is TypeScript and
DOM with no framework (`web/`). `README.md` gives the overview and `docs/` the detail:
[song format](docs/song-format.md), [architecture](docs/architecture.md),
[deploying](docs/deploying.md).

## Setup

```sh
mise install && bun install
sh scripts/git/install-hooks.sh
```

Rust comes from rustup, which installs the toolchain in `rust-toolchain.toml`.

## Validation

`bun run check` (`scripts/checks/checkAll.sh`) is the full local gate; the pre-push
hook runs it, and CI runs the same checks. While iterating:

```sh
bun run engine:check                 # rustfmt, clippy -D warnings, cargo test
bun run test                         # build the engine, then bun test
bun run typecheck && bunx biome ci   # TypeScript and Biome
bun run songs:check                  # songs are valid and canonical
bun run lint:binary-files            # no binary files since upstream (or pass --staged, --all)
bun run dev                          # http://localhost:8174, rebuilding on change
```

Check UI changes in a browser as well as in tests. `bun run render <song>` renders a
song with the same engine, for checking sound changes offline.

## Conventions

- Branches: `<type>/<name>`, e.g. `feat/clap-voice`. Commits and PR titles: Conventional
  Commits, at most 50 characters, lowercase subject. Commits are signed and carry no
  `Co-authored-by` trailers; the hooks reject both.
- No binary files in Git (`scripts/checks/checkBinaryFiles.sh`). Every sound is
  synthesized; there are no samples to commit.
- Every colour is a grey with equal red, green and blue (`web/test/grayscale.test.ts`).
- The sound is dark: minor keys, low filter cutoffs and dark reverb by default. Keep new
  defaults and example songs in that spirit.
- Songs are canonical (`bun run songs:fmt`). Never hand-format a `.dnbm.json` file, and
  never add volatile data (timestamps, random ids) to the format.
- Instrument parameters are positional between `engine/src/instruments/mod.rs` and
  `web/src/song/instruments.ts`; change both together (see "Adding an instrument" in
  `docs/architecture.md`). A format change bumps `FORMAT_VERSION` and needs a migration.
- The engine is deterministic and its output never exceeds full scale; tests check both.
  Keep noise seeded, and keep the render path free of allocation (only song loads allocate).
- `tsconfig.json` extends `@tsconfig/strictest`; index-signature access uses brackets
  (`record["key"]`), so Biome's `useLiteralKeys` is off.

## Shipping

PR workflows come from the `@a2f0/agent-tool` dev dependency: use `open-pr` to open a
PR and `ship-pr` to ship one end to end (independent review, repairs, merge, cleanup).
Run them with `bun run agent-tool ...`. Do not edit the managed skill copies in
`.agents/skills` and `.claude/skills`; after upgrading the dependency, run
`bun run agents:sync` and commit the dependency, lockfile, skills and
`.agent-tool-skills.json` together. The required check is `CI gate` (see
`agent-tool.json`); packages are not versioned.

Merging deploys only once the `DNBM_DEPLOY` repository variable is set; until then,
`bun run deploy` publishes by hand (see `docs/deploying.md`).

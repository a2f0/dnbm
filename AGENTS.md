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
`@a2f0/dnbm`, whose two entrypoints are in `src/` with the shell (`src/shell.ts`) that
mounts an app into a shadow root in a host's document and the commands and state each
app offers its host (`src/control.ts`), and the build bundles the synth into each app.
`README.md` gives the overview, `packages/sequencer/README.md` and
`packages/player/README.md` how to use each app, and `docs/` the detail:
[song format](docs/song-format.md), [architecture](docs/architecture.md),
[package](docs/package.md), [deploying](docs/deploying.md),
[development](docs/development.md).

## Setup

```sh
mise install && bun install
bun run hooks:install
```

Rust comes from rustup, which installs the toolchain in `rust-toolchain.toml`.
Existing clones migrating from the old hook installer must inspect their installed
hooks, then run `bun run hooks:install --adopt`; see [development](docs/development.md#git-hooks).

## Validation

`bun run check` (`scripts/testing/check.json`) is the full local gate; the pre-push
hook runs it, and CI runs the same checks. The package test mounts the packed apps in
host pages in Google Chrome (through `playwright-core`), with the assets on the host's
origin and on another, and loads the site's own pages under its content security
policy, so checks need Chrome installed, as GitHub's runners have.

While iterating:

```sh
bun run engine:check                 # rustfmt, clippy -D warnings, cargo test
bun run test                         # build the engine, then bun test
bun run typecheck && bunx biome ci   # TypeScript and Biome
bun audit                            # package security advisories
bun run songs:check                  # songs are valid and canonical
bun run lint:binary-files            # no binary files since upstream (or pass --staged, --all)
bun run build:package                # the npm package, into lib/ and site/
bun run dev                          # http://localhost:8174 (player: /player/), rebuilding
```

Check UI changes in a browser as well as in tests. `bun run render <song>` renders a
song with the same engine, for checking sound changes offline.

## Output capture

Run finite, noisy commands, such as installs, builds, tests, linters, and Git commands
that run hooks, through `bun run agent:run --label <name> -- <command> [args...]`, for
example `bun run agent:run --label tests -- bun run test`. It keeps complete output in
a private log, preserves the exit status, and prints a compact receipt, with a bounded
excerpt of the log on failure. Read more with `bun run agent:logs <log-path>`, raising
`--tail-lines` or `--max-bytes` as needed, or with a targeted search of the log. A zero
exit does not rule out warnings: inspect required warnings, timings, and artifacts
before accepting a check. Run reviews, version preparation, audits, infrastructure
previews, and run-group checks directly so their results stay visible, and run
interactive tools and servers directly too. Never narrow a suite or silence warnings to
reduce output.

`bun run check` is a run group: it already captures each step and prints a durable
run-group report, so run it directly to keep its structured evidence visible.

## Conventions

- Branches: `<type>/<name>`, e.g. `feat/clap-voice`. Commits and PR titles: Conventional
  Commits, at most 50 characters, lowercase subject. Commits are signed and carry no
  `Co-authored-by` trailers; the hooks reject both.
- No binary files in Git (`bun run lint:binary-files`). Every sound is
  synthesized; there are no samples to commit.
- The brand mark is `assets/brand/logo.svg`, plain static SVG as agent-tool's image
  sources require. The build renders the favicons from it into `dist/` with
  `agent-tool images build favicons`, and a production build also renders the share
  image with `social` (the `images` section of `agent-tool.json`); edit the SVG or those
  targets, never a rendered file.
- Every build adds the pages' canonical links and sharing tags, hard-coded to
  dnbm.a2f0.net so a host's copy points at the site, and only the production build adds
  the share image, `robots.txt`, sitemap and 404 page (`scripts/build/siteMetadata.ts`;
  see [deploying](docs/deploying.md#search-and-sharing)). Never derive these URLs from the
  page's address. Keep each page's title and description in its `index.html`.
- Every colour is a grey with equal red, green and blue (`test/grayscale.test.ts`).
- The apps run inside host pages (`@a2f0/dnbm` mounts them into a shadow root in the
  host's document, and the site's own pages mount them the same way), so an app stays
  inside its root: listen for keys, presses and drops on its frame, not the window or
  document; look up elements through its root (`getRootNode()`), not `document`;
  scroll only its own containers (`reveal` in `packages/sequencer/src/ui/dom.ts`), never
  with `scrollIntoView`, which scrolls the host page too; resolve URLs from the assets
  URL, not the page; set no globals or page title; and
  release audio, workers, timers, animation frames and any window listener when its
  signal aborts. Don't use `window.confirm`, `prompt` or `alert`, which block the host
  page: use `packages/sequencer/src/ui/dialog.ts`. Anything a browser may refuse, such
  as a file picker, needs a fallback. Don't cancel a press's `pointerdown`, which keeps
  the browser from dispatching its `mousedown` at all: the host's own listeners must
  hear every press, as its menus close on them. Keep drags from selecting text or
  scrolling with `user-select` and `touch-action` instead.
- A host drives an app through its instance's `run`, `state` and `subscribe`
  (`src/control.ts`), never its DOM. A command does exactly what its button or
  shortcut does, through the same code; an app publishes its state through
  `onState` whenever it may have changed, and a command it can't take now is
  unavailable in that state. Adding a command or a state field is public API.
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

## Dependency updates

Use the installed `update-dependencies` skill and read
[dependency maintenance](docs/dependency-upgrades.md). Keep reusable procedures
and active constraints there, updating entries in place and removing resolved
ones. Put run-specific versions, audits, validation, previews, and held groups
in the upgrade PR. Keep README focused on the product, setup, and normal usage
with a short maintenance link; do not append upgrade reports there.

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
`.github/workflows/npm-publish.yml`; verify the exact merged release with
`bun run agent-tool release verify @a2f0/dnbm <version> <merge-sha> --workflow "Publish npm package"`,
and report a failed publish separately from the merge. The package's public API is
`mountDnbm`, `mountDnbmPlayer` and `copyDnbmAssets`, with the instances they return and
the asset layout `copyDnbmAssets` copies, and the commands and state the instances
offer; keep it backward compatible or bump the minor version.

Merging deploys only once the `DNBM_DEPLOY` repository variable is set; until then,
`bun run deploy` publishes by hand (see `docs/deploying.md`).

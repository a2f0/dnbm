# Development

| Path                  | What                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/synth/`     | The shared synthesizer: the Rust audio engine (`engine/`), its AudioWorklet host, and the song format                                 |
| `packages/sequencer/` | The editor and mixer (TypeScript and DOM); see [its README](../packages/sequencer/README.md)                                          |
| `src/`                | The npm package's entrypoints (`mountDnbm`, `mountDnbmPlayer`, `copyDnbmAssets`), and the shell that mounts an app into a shadow root |
| `packages/player/`    | A playlist player that plays songs through the same synthesizer; see [its README](../packages/player/README.md)                       |
| `test/`               | Repository-wide tests: the packed npm package, and the greys-only rule                                                                |
| `songs/`              | Example songs                                                                                                                         |
| `assets/brand/`       | The brand mark (`logo.svg`); the build renders the site's favicons from it (`favicons` in `agent-tool.json`)                          |
| `scripts/`            | Build, dev server, WAV render, song formatter, git hooks and checks                                                                   |
| `docs/`               | [Song format](song-format.md), [architecture](architecture.md), [package](package.md), [deploying](deploying.md)                      |

## Commands and ownership

Run commands from the repository root. Keep the supported `package.json` names
stable for people, hooks, and CI: `build`, `build:engine`, `build:package`, `dev`,
`render`, `songs:check`, `songs:fmt`, `check`, and `hooks:install`.
The [script directory](../scripts/README.md) groups implementation by purpose;
application code and engine-specific tooling stay in their packages.

Shared Git/GitHub workflow mechanics, managed skills, and harness permission rules
come from the exact-pinned agent-tool dependency. Repository policy lives in
`agent-tool.json`; do not copy shared algorithms into new local scripts or edit
generated skills or rules. Follow [AGENTS.md](../AGENTS.md) for review, versioning,
and shipping requirements.

## Validation

`bun run check` runs the complete local gate: binary-file policy, ShellCheck,
Biome, canonical songs, TypeScript, shared skills and permission rules,
Rust formatting/clippy/tests, the WebAssembly/site build, all Bun tests, and a
Wrangler deployment dry run.
The pre-push hook also validates pushed branches and commit trust before this gate.
Run `bun audit` separately; CI's lint job requires it too.

Tests use installed Google Chrome through `playwright-core`, including real host
pages for the packed npm app. Keep same-origin/cross-origin assets, content security
policy, abort cleanup, greyscale, and standalone tracking coverage. The Rust build
uses the pinned rustup toolchain and `wasm-opt` from `.mise.toml`.

`bun run check` uses `scripts/testing/check.json` to run the same steps sequentially
through agent-tool. It prints a structured report with per-step logs and source
fingerprints; `bun run agent-tool runs list --head <commit>` finds stored receipts.
A failed command or changed source fails the group. Keep this report visible.
Capture other noisy finite commands as [output capture](../AGENTS.md#output-capture)
describes. Interactive `bun run dev` runs directly. Check UI changes in a real
browser, and use `bun run render <song>` to inspect audio changes offline.

## Git hooks

`bun run hooks:install` installs the three tracked hooks declared in `agent-tool.json`.
`bun run hooks:check` reports drift; pre-push also compares its own copied body and
checks every managed hook before the full gate. The installer preserves unknown hooks
and keeps backups when replacing owned files.

For an existing clone using the previous installer, inspect its effective hook directory
(`git config --path core.hooksPath`, or the common Git directory's `hooks/`). After
confirming the three installed hook files are the expected repository copies, use
`bun run hooks:install --adopt` once to transfer their ownership. Resolve local hook edits
before adoption; normal subsequent installs omit `--adopt`.

Branches use the configured Conventional Commits types, with `main` exempt and no
additional length cap. Commit headers have the existing 50-character limit, lowercase
initial subject, and no terminal period; generated Git messages retain their exemptions.
Signature checks require a present, non-bad signature, not local key trust. Coauthor
trailers are rejected. Pre-push validates destination branch names from Git's ref tuples
and keeps dnbm's first-push base and tree-range selection. Commit checks additionally
exclude commits already reachable from the named push remote's tracking refs, so
integrating an updated main branch does not recheck previously published history.
Pre-commit retains detached-HEAD support for rebases and bisects; pre-push still
checks actual destination refs. CI passes the actual PR branch
name explicitly, so detached checkouts do not need to be changed to inspect a name.

## Documentation and releases

README covers the product, setup, and everyday commands, and the sequencer's and
player's READMEs cover using each app. Keep application design in
[architecture](architecture.md), embedding and npm releases in
[package](package.md), site operations in [deploying](deploying.md), and active
upgrade constraints in [dependency maintenance](dependency-upgrades.md).
Update those guides alongside their commands. Validation/review evidence for one
change belongs in its PR, rather than a dated repository journal.

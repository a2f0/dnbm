# Dependency maintenance

Use the installed `update-dependencies` skill and follow
[repository validation and shipping guidance](../AGENTS.md). Bun owns the
workspace lockfile; `.mise.toml` pins controller tools, and
`rust-toolchain.toml` pins Rust and the WebAssembly target. Preserve the
[package's supported consumer runtimes](package.md) when updating build tools.

## Audit and validation

Run `bun audit` against the baseline and final lockfiles; CI also audits
dependencies in the lint job. Audits use the live advisory database and run
separately from `bun run check` and the package release checks. The native tooling
smoke test checks API compatibility separately. A passed build does not establish
a clean audit or deployment safety; follow the skill's preview requirements
before any separately authorized [deployment](deploying.md).

## Active security override

The exact Miniflare `sharp` override selects 0.35.5, whose prebuilt libvips
includes librsvg 2.63.2 and fixes
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
The pinned Wrangler's Miniflare still requests sharp 0.35.4. This patch keeps
the same Node requirement and image API; it affects development tooling.
Remove the override once Wrangler's Miniflare includes the fix, then run
`bun audit` and `bun run check` again.

## Recording an upgrade

Keep each run's selected versions, migrations, audits, warnings, validation,
previews, and held groups in its PR. Keep only reusable procedure and unresolved
constraints here, with evidence links and removal or revisit conditions. Update
entries in place and remove resolved ones instead of appending an upgrade
journal. Identify historical audit observations by their source PR; they do not
establish a fresh audit. Keep credentials, private logs, state, and plans out of
public reports.

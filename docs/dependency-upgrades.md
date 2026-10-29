# Dependency maintenance

Use the installed `update-dependencies` skill and follow
[repository validation and shipping guidance](../AGENTS.md). Bun owns the
workspace lockfile; `.mise.toml` pins controller tools, and
`rust-toolchain.toml` pins Rust and the WebAssembly target. Preserve the
[package's supported consumer runtimes](package.md) when updating build tools.

## Lockfile regeneration

Bun 1.4.4 writes lockfile format 3 when the manifest has nested overrides, and
normalizes it to format 2 after they are removed. A lower format number alone
therefore does not show that an older runtime generated it. Let the pinned Bun
[regenerate the lockfile](https://bun.com/docs/pm/lockfile), then verify
`bun --version` and that `bun install --frozen-lockfile` succeeds without changing
its hash. Never hand-edit the format number. Recheck this behavior when changing
Bun or introducing another nested override.

## Audit and validation

Run `bun audit` against the baseline and final lockfiles; CI also audits
dependencies in the lint job. Audits use the live advisory database and run
separately from `bun run check` and the package release checks. The native tooling
smoke test checks API compatibility separately. A passed build does not establish
a clean audit or deployment safety; follow the skill's preview requirements
before any separately authorized [deployment](deploying.md).

## Browser tests

The browser suites' Chrome (`scripts/testing/chrome.ts`) passes its own
`--disable-features`, and Chrome reads only the last one, so it repeats
playwright-core's list (`chromiumSwitches`). `scripts/testing/chrome.test.ts` fails
when a playwright-core upgrade changes that list; copy the new one. The extra
`UnexportableKeyDeletion` stops Chrome on macOS from spending about five seconds in
the keychain after each context closes. If a Chrome update renames it, closing slows
down again and `closeChrome` warns that it killed Chrome.

## Deployment compatibility

The assets-only Worker has no bindings or migrations; its custom domain belongs
in a2f0.net's Terraform configuration. Keep routes absent here so Wrangler does
not take ownership of that domain. Before upgrading Wrangler, compare the live
Worker version and bindings with this configuration, verify the domain through
its owning Terraform plan, and preview the exact built assets. A successful
bundle alone does not verify those identities.

`upload_source_maps: false` preserves the upload policy from before
[Wrangler 4.150](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.150.0)
changed its default. The site's existing linked source maps remain static assets.
Revisit this explicit setting only when changing the source-map publication policy.

The `DNBM_DEPLOY` switch controls automatic main-branch deployment. Before enabling
it, add an authenticated preview and identity guard to that job, covering the
existing Worker and Terraform-owned domain, and bind deployment to the checked
artifacts. The ordinary CI dry-run checks bundling without that remote proof.

## Release tools

Keep the npm pack job's mise cache disabled. Its output is the artifact consumed
by the trusted publisher; restoring tools from a lower-trust cache can alter that
artifact. This follows the
[mise-action release workflow guidance](https://github.com/jdx/mise-action#release-workflows).
The test jobs may cache tools, while the publish job consumes only the packed
artifact and keeps package-manager caching disabled.

## Recording an upgrade

Keep each run's selected versions, migrations, audits, warnings, validation,
previews, and held groups in its PR. Keep only reusable procedure and unresolved
constraints here, with evidence links and removal or revisit conditions. Update
entries in place and remove resolved ones instead of appending an upgrade
journal. Identify historical audit observations by their source PR; they do not
establish a fresh audit. Keep credentials, private logs, state, and plans out of
public reports.

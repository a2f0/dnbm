#!/bin/sh
set -eu

# The full local gate: everything CI checks, in roughly the order it fails fastest.
# The pre-push hook runs it, and so does `bun run check`.

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

step() {
  echo ""
  echo "==> $1"
}

step "Checking for binary files"
sh scripts/checks/checkBinaryFiles.sh --all

step "Linting shell scripts"
sh scripts/checks/lintScripts.sh

step "Linting and formatting TypeScript, JSON and CSS (Biome)"
bunx --no-install biome ci

step "Checking song files are valid and canonical"
bun scripts/songs.ts check

step "Typechecking"
bunx --no-install tsc -p tsconfig.json

step "Checking agent skills"
bun run --silent agents:check >/dev/null

step "Checking the engine (rustfmt, clippy, cargo test)"
cargo fmt --manifest-path packages/synth/engine/Cargo.toml --check
cargo clippy --quiet --manifest-path packages/synth/engine/Cargo.toml --all-targets -- -D warnings
cargo test --quiet --manifest-path packages/synth/engine/Cargo.toml

step "Building the site (engine, wasm-opt, bundles)"
bun scripts/build.ts >/dev/null

step "Testing (song format, store, engine through WebAssembly, grayscale)"
bun test

step "Checking the deploy config"
bunx --no-install wrangler deploy --dry-run >/dev/null

echo ""
echo "All checks passed."

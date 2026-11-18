#!/bin/sh
set -eu

# Lint every shell script in the repo (including git hooks) with ShellCheck.

CDPATH='' cd -P -- "$(dirname -- "$0")/../.."

command -v shellcheck >/dev/null 2>&1 || {
  echo "Error: shellcheck is required (mise install, or brew install shellcheck)." >&2
  exit 1
}

# Git hooks can export an index or worktree that overrides the directory above.
git_variables=$(git rev-parse --local-env-vars)
for name in $git_variables; do unset "$name"; done

checkout=$(pwd -P)
root=$(git rev-parse --show-toplevel)
[ "$root" = "$checkout" ] || { echo "Shell lint requires its own Git checkout." >&2; exit 1; }

# Tracked and untracked-but-not-ignored scripts, including the git hooks.
files=$(mktemp)
trap 'rm -f "$files"' EXIT
git ls-files --cached --others --exclude-standard -z -- '*.sh' 'scripts/git/hooks/*' > "$files"
xargs -0 shellcheck -x < "$files"

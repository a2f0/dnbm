#!/bin/sh
set -eu

# Lint every shell script in the repo (including git hooks) with ShellCheck.

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

command -v shellcheck >/dev/null 2>&1 || {
  echo "Error: shellcheck is required (mise install, or brew install shellcheck)." >&2
  exit 1
}

# Tracked and untracked-but-not-ignored scripts, including the git hooks.
git ls-files --cached --others --exclude-standard -z -- '*.sh' 'scripts/git/hooks/*' |
  xargs -0 shellcheck -x

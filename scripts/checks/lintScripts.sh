#!/bin/sh
set -eu

# Lint every shell script in the repo (including git hooks) with ShellCheck.

CDPATH='' cd -- "$(dirname -- "$0")/../.."

command -v shellcheck >/dev/null 2>&1 || {
  echo "Error: shellcheck is required (mise install, or brew install shellcheck)." >&2
  exit 1
}

# Tracked and untracked-but-not-ignored scripts, including the git hooks.
git ls-files --cached --others --exclude-standard -z -- '*.sh' 'scripts/git/hooks/*' |
  xargs -0 shellcheck -x

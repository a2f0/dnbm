#!/bin/sh
set -eu

# Branch names are <type>/<name>, where <type> is a Conventional Commits type,
# e.g. feat/clap-voice or fix/swing-timing. main is exempt.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/checks/conventionalTypes.sh
. "$SCRIPT_DIR/conventionalTypes.sh"

# Detached HEAD (rebases, bisects) has no branch to check.
branch=$(git symbolic-ref --quiet --short HEAD) || exit 0

[ "$branch" = "main" ] && exit 0

if printf '%s\n' "$branch" |
  grep -qE '^[a-z][a-z0-9-]*/[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$' &&
  is_conventional_type "${branch%%/*}"; then
  exit 0
fi

echo "Error: branch '$branch' should be <type>/<name>, e.g. feat/clap-voice." >&2
echo "Types: $CONVENTIONAL_TYPES" >&2
exit 1

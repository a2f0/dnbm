#!/bin/sh
set -eu

# Conventional Commits header check, equivalent to commitlint with
# @commitlint/config-conventional (plus "cleanup" and a 50-character header).
#
# Usage: lintCommitMessage.sh <commit-message-file>

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/checks/conventionalTypes.sh
. "$SCRIPT_DIR/conventionalTypes.sh"

[ "$#" -eq 1 ] || {
  echo "Usage: $0 <commit-message-file>" >&2
  exit 2
}

# The header is the first line that isn't a git comment.
header=$(grep -v '^#' "$1" | sed -n '/[^[:space:]]/{p;q;}')

# Messages git writes itself, which commitlint ignores by default.
case "$header" in
  "Merge "* | "Revert \""* | "fixup! "* | "squash! "* | "amend! "* | "Initial commit")
    exit 0
    ;;
esac

fail() {
  echo "Error: $1" >&2
  echo "  $header" >&2
  echo "Expected '<type>(<optional scope>): <subject>', e.g. 'feat(engine): add a clap'." >&2
  echo "Types: $CONVENTIONAL_TYPES" >&2
  exit 1
}

[ -n "$header" ] || fail "commit message is empty."

length=$(printf '%s' "$header" | wc -m | tr -d ' ')
[ "$length" -le "$COMMIT_HEADER_MAX_LENGTH" ] ||
  fail "header is $length characters; the limit is $COMMIT_HEADER_MAX_LENGTH."

printf '%s\n' "$header" | grep -qE '^[a-z]+(\([a-z0-9._/-]+\))?!?: [^ ]' ||
  fail "header is not a Conventional Commits header."

type=${header%%[(!:]*}
is_conventional_type "$type" || fail "'$type' is not an allowed type."

subject=${header#*: }
case "$subject" in
  [[:upper:]]*) fail "subject must not start with an uppercase letter." ;;
  *.) fail "subject must not end with a period." ;;
esac

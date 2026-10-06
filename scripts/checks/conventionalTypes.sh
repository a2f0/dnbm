# shellcheck shell=sh
# Shared by the commit message and branch name lints. Mirrors
# @commitlint/config-conventional's type-enum, plus "cleanup".

# shellcheck disable=SC2034 # read by the scripts that source this file
CONVENTIONAL_TYPES="build chore ci cleanup docs feat fix perf refactor revert style test"
# shellcheck disable=SC2034
COMMIT_HEADER_MAX_LENGTH=50

is_conventional_type() {
  for conventional_type in $CONVENTIONAL_TYPES; do
    [ "$1" = "$conventional_type" ] && return 0
  done
  return 1
}

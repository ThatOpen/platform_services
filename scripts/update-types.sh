#!/usr/bin/env bash
# Refresh the backend contract types.
#
# The shared DTOs live in the backend repo, so they arrive here as a git
# submodule. Two things this script does that a plain `git submodule update`
# does not:
#
#   1. Applies a sparse checkout, so only `src/common/dto` lands on disk
#      instead of the whole backend repository. Sparse config lives in the
#      submodule's .git and is not committed, so it has to be re-applied on
#      every fresh clone — including in CI.
#   2. Moves the pin to the tip of the tracked branch. Deliberately a command
#      you run, not a postinstall hook: an install that silently moved the
#      pin would break builds with no commit explaining why.
#
# After running this, `git add vendor/backend-api` and commit the new pin.
set -euo pipefail

SUBMODULE_PATH="vendor/backend-api"
SPARSE_PATH="src/common/dto"

git submodule update --init "$SUBMODULE_PATH"

git -C "$SUBMODULE_PATH" sparse-checkout init --cone
git -C "$SUBMODULE_PATH" sparse-checkout set "$SPARSE_PATH"

if [ "${1:-}" = "--pin-only" ]; then
  echo "Pinned at $(git -C "$SUBMODULE_PATH" rev-parse --short HEAD) (not moved)."
  exit 0
fi

git submodule update --remote "$SUBMODULE_PATH"
git -C "$SUBMODULE_PATH" sparse-checkout set "$SPARSE_PATH"

BRANCH=$(git config -f .gitmodules "submodule.$SUBMODULE_PATH.branch")
echo "Types updated from '$BRANCH' at $(git -C "$SUBMODULE_PATH" rev-parse --short HEAD)."
echo "Commit the new pin with: git add $SUBMODULE_PATH"

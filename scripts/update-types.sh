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
BACKEND_REPO="ThatOpen/platform_backend-api"
KEY_SECRET="BACKEND_TYPES_DEPLOY_KEY"
APP_ID_SECRET="BACKEND_TYPES_APP_ID"
APP_KEY_SECRET="BACKEND_TYPES_APP_PRIVATE_KEY"
TOKEN_SECRET="BACKEND_TYPES_TOKEN"

# The backend repo is private. Locally that is fine, git uses whatever
# credentials you already have. In CI there is no such thing, and the failure
# is a bare "Repository not found" that says nothing about what to do, so
# spell it out instead.
token_instructions() {
  cat <<INSTRUCTIONS

  The runner could not read ${BACKEND_REPO}.

  This repo vendors the backend's shared DTOs as a submodule, and that repo
  is private, so CI needs a token with read access to it. The default
  GITHUB_TOKEN cannot see other repositories.

  Preferred fix, a GitHub App. Nothing long-lived is granted: the workflow
  mints a token scoped to that one repo, valid for an hour.

    1. https://github.com/organizations/ThatOpen/settings/apps/new
         Name        : anything unique, e.g. "ThatOpen CI types reader"
         Homepage URL: https://github.com/ThatOpen
         Webhook     : UNTICK "Active", or it demands a webhook URL
         Permissions -> Repository -> Contents: Read-only (nothing else)
         Where installed: Only on this account

    2. On the App page, note the App ID, then "Generate a private key".
       That downloads a .pem file.

    3. Install App -> ThatOpen -> Only select repositories ->
       platform_backend-api

    4. Add two secrets here:
         ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-<this repo>}/settings/secrets/actions
         ${APP_ID_SECRET}          : the App ID from step 2
         ${APP_KEY_SECRET} : the whole .pem, BEGIN and END lines included

    5. Delete the .pem locally and re-run this job.

  Quicker alternative, a fine-grained token. Expires within a year and is
  tied to whoever made it:

    1. https://github.com/settings/personal-access-tokens/new
         Resource owner        : ThatOpen
         Repository access     : Only select repositories -> platform_backend-api
         Repository permissions: Contents -> Read-only
    2. Store it as ${TOKEN_SECRET} in this repo's Actions secrets. Because
       the owner is the organisation, it may sit in "pending approval"
       until an org owner accepts it.

  A read-only deploy key stored as ${KEY_SECRET} also works.

  If one of these is already set, it has most likely been revoked or lost
  access to ${BACKEND_REPO}. A token may simply have expired.

INSTRUCTIONS
}

fail_with_instructions() {
  local headline="$1"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error title=Backend types unavailable::${headline} See the log for how to fix it."
    token_instructions
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      {
        echo "## Backend contract types could not be fetched"
        echo
        echo "**${headline}**"
        echo '```'
        token_instructions
        echo '```'
      } >>"$GITHUB_STEP_SUMMARY"
    fi
  else
    echo "${headline}"
    token_instructions
  fi
  exit 1
}

# Only enforced in CI. A developer's own git credentials already cover the
# private repo, so requiring the token locally would be noise.
if [ -n "${CI:-}" ] &&
   [ -z "${BACKEND_TYPES_DEPLOY_KEY:-}" ] &&
   [ -z "${BACKEND_TYPES_TOKEN:-}" ]; then
  fail_with_instructions \
    "Neither ${KEY_SECRET} nor ${TOKEN_SECRET} is set."
fi

# Both rewrite the submodule's https URL rather than changing .gitmodules, so
# a developer cloning over https locally is unaffected. Scoped to this
# process and undone on the way out, so the credential never becomes the
# identity for anything else in the job.
if [ -n "${BACKEND_TYPES_DEPLOY_KEY:-}" ]; then
  KEY_FILE=$(mktemp)
  printf '%s\n' "$BACKEND_TYPES_DEPLOY_KEY" >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
  export GIT_SSH_COMMAND="ssh -i $KEY_FILE -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  git config --global "url.git@github.com:.insteadOf" "https://github.com/"
  trap 'rm -f "$KEY_FILE"; git config --global --unset-all "url.git@github.com:.insteadOf" || true' EXIT
elif [ -n "${BACKEND_TYPES_TOKEN:-}" ]; then
  git config --global \
    "url.https://x-access-token:${BACKEND_TYPES_TOKEN}@github.com/.insteadOf" \
    "https://github.com/"
  trap 'git config --global --unset-all "url.https://x-access-token:${BACKEND_TYPES_TOKEN}@github.com/.insteadOf" || true' EXIT
fi

if ! git submodule update --init "$SUBMODULE_PATH"; then
  fail_with_instructions "Could not clone the backend types submodule."
fi

git -C "$SUBMODULE_PATH" sparse-checkout init --cone
git -C "$SUBMODULE_PATH" sparse-checkout set "$SPARSE_PATH"

if [ "${1:-}" = "--pin-only" ]; then
  echo "Pinned at $(git -C "$SUBMODULE_PATH" rev-parse --short HEAD) (not moved)."
  exit 0
fi

if ! git submodule update --remote "$SUBMODULE_PATH"; then
  fail_with_instructions "Could not update the backend types submodule."
fi
git -C "$SUBMODULE_PATH" sparse-checkout set "$SPARSE_PATH"

BRANCH=$(git config -f .gitmodules "submodule.$SUBMODULE_PATH.branch")
echo "Types updated from '$BRANCH' at $(git -C "$SUBMODULE_PATH" rev-parse --short HEAD)."
echo "Commit the new pin with: git add $SUBMODULE_PATH"

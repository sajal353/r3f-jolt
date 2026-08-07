#!/usr/bin/env bash
#
# Commit with the project's GPG key, after the four gates pass.
#
#   scripts/commit.sh -F .notes/message.txt
#   scripts/commit.sh -m "subject line"
#   scripts/commit.sh --no-gates -F message.txt
#
# GPG_TTY is exported because gpg-agent's pinentry needs a terminal to ask for
# the passphrase on; without it a signed commit fails with "Inappropriate ioctl
# for device" rather than prompting.

set -euo pipefail

cd "$(dirname "$0")/.."

run_gates=1
amend=0
message_args=()

while [ $# -gt 0 ]; do
  case "$1" in
    --no-gates)
      run_gates=0
      shift
      ;;
    --amend)
      amend=1
      shift
      ;;
    -m | -F)
      message_args+=("$1" "$2")
      shift 2
      ;;
    *)
      echo "usage: scripts/commit.sh [--no-gates] [--amend] (-m <message> | -F <file>)" >&2
      exit 64
      ;;
  esac
done

if [ ${#message_args[@]} -eq 0 ]; then
  echo "scripts/commit.sh: a message is required (-m or -F)" >&2
  exit 64
fi

signing_key="$(git config --get user.signingkey || true)"

if [ -z "$signing_key" ]; then
  echo "scripts/commit.sh: git config user.signingkey is not set" >&2
  exit 1
fi

if ! gpg --list-secret-keys "$signing_key" >/dev/null 2>&1; then
  echo "scripts/commit.sh: no secret key for $signing_key in this keyring" >&2
  exit 1
fi

if [ "$run_gates" -eq 1 ]; then
  echo "==> lint"
  pnpm run lint
  echo "==> typecheck"
  pnpm run typecheck
  echo "==> test"
  pnpm test
  echo "==> build"
  pnpm run build
fi

GPG_TTY="${GPG_TTY:-$(tty 2>/dev/null || echo)}"
export GPG_TTY

commit_args=(--gpg-sign="$signing_key" "${message_args[@]}")
[ "$amend" -eq 1 ] && commit_args+=(--amend)

git add -A
git commit "${commit_args[@]}"

# %G? is G for a good signature, N for none. A commit that silently went
# unsigned is the thing worth catching here.
status="$(git log -1 --format='%G?')"

if [ "$status" != "G" ] && [ "$status" != "U" ]; then
  echo "scripts/commit.sh: commit is NOT signed (status '$status')" >&2
  exit 1
fi

git log -1 --format='signed %G? by %GS%n%h %s'

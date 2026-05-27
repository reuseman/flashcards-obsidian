#!/usr/bin/env bash
# Reject staged test-vault/**.md diffs that introduce block-id anchors.
# These are plugin-written artifacts from manual sync runs; they must
# never be committed. Run `npm run test-vault:reset` to clean them.

set -euo pipefail

staged=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^test-vault/.*\.md$' || true)
[ -z "$staged" ] && exit 0

# shellcheck disable=SC2086
bad=$(git diff --cached -U0 -- $staged | grep -E '^\+.*\^[A-Za-z0-9]{6,}\b' || true)

if [ -n "$bad" ]; then
  echo "✗ block-id anchors found in staged test-vault/**.md changes:" >&2
  echo "$bad" >&2
  echo >&2
  echo "Run: npm run test-vault:reset" >&2
  exit 1
fi

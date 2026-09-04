#!/usr/bin/env bash
# Reject staged test-vault/**.md diffs that introduce generated card identity
# or sync state. These are plugin-written artifacts from manual sync runs; they
# must never be committed. Run `npm run test-vault:reset` to clean them.

set -euo pipefail

find_bad_lines() {
  local file=$1
  local diff=$2
  local anchor_pattern
  local registry_pattern

  anchor_pattern='^\+.*\^(q-[[:alnum:]]{4}|[[:digit:]]{13})[[:space:]]*$'

  case "$file" in
    test-vault/scenarios/auto-fixes/06-existing-card-sync.md | \
      test-vault/scenarios/mixed/legacy-and-v2.md | \
      test-vault/scenarios/v2-clean/already-synced.md)
      # These scenarios intentionally start with synthetic identity entries.
      # A real successful manual sync adds a `sync` fingerprint, which must
      # never become part of their committed baseline.
      registry_pattern='^\+[[:space:]]+(q-[[:alnum:]]{4}|"?[[:digit:]]{13}"?):[[:space:]]+\{[^}]*sync:'
      ;;
    *)
      registry_pattern='^\+[[:space:]]+(q-[[:alnum:]]{4}|"?[[:digit:]]{13}"?):[[:space:]]+\{[^}]*((cue|nid|hash|sync):)'
      ;;
  esac

  printf '%s\n' "$diff" | grep -E "$anchor_pattern|$registry_pattern" || true
}

bad=""
if [ "${1:-}" = "--check-diff" ]; then
  bad=$(find_bad_lines "${3:-test-vault/features/example.md}" "${2:-}")
else
  mapfile -t staged < <(
    git diff --cached --name-only --diff-filter=ACM |
      grep -E '^test-vault/.*\.md$' || true
  )
  [ "${#staged[@]}" -eq 0 ] && exit 0

  for file in "${staged[@]}"; do
    diff=$(git diff --cached -U0 -- "$file")
    matches=$(find_bad_lines "$file" "$diff")
    if [ -n "$matches" ]; then
      bad="${bad}${bad:+$'\n'}${file}:$'\n'${matches}"
    fi
  done
fi

if [ -n "$bad" ]; then
  echo "✗ generated card identity or sync state found in staged test-vault/**.md changes:" >&2
  echo "$bad" >&2
  echo >&2
  echo "Run: npm run test-vault:reset" >&2
  exit 1
fi

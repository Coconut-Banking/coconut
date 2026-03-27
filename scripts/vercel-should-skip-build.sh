#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 = skip build, exit 1 = run build.
# Skips when the only changes vs the last deployment are non-app paths.

set -euo pipefail

if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]]; then
  exit 1
fi

diff_output=$(git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" "$VERCEL_GIT_COMMIT_SHA")

if [[ -z "$diff_output" ]]; then
  exit 0
fi

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" == docs/* ]] || [[ "$f" == .github/* ]] || [[ "$f" == supabase/migrations/* ]] || [[ "$f" == *.md ]]; then
    continue
  fi
  exit 1
done <<< "$diff_output"

exit 0

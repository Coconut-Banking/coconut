#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 = skip build, exit 1 = run build.
# Skips when the only changes vs the last deployment are non-app paths.

set -euo pipefail

# Skip all preview deployments — only build on main.
# CI (GitHub Actions) already runs `npm run build` on PRs.
if [[ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]]; then
  echo "Skipping preview build for branch: $VERCEL_GIT_COMMIT_REF"
  exit 0
fi

if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]]; then
  exit 1
fi

diff_output=$(git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" "$VERCEL_GIT_COMMIT_SHA")

if [[ -z "$diff_output" ]]; then
  exit 0
fi

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  # Never skip when schema migrations change — deploy so ops know to apply SQL in Supabase.
  if [[ "$f" == supabase/migrations/* ]]; then
    echo "Migration changed: $f — running build"
    exit 1
  fi
  if [[ "$f" == docs/* ]] || [[ "$f" == .github/* ]] || [[ "$f" == *.md ]]; then
    continue
  fi
  exit 1
done <<< "$diff_output"

exit 0

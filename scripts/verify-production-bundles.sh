#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(dirname "$script_directory")"

cd "$repository_root"
export CI=1
export NODE_ENV=production

pnpm --filter @family/parent exec expo export --platform ios --output-dir dist/ios --clear
pnpm --filter @family/parent exec expo export --platform android --output-dir dist/android --clear
pnpm --filter @family/dashboard build

if rg -n 'family-app-development-credential-import|development-fixture-token-claims' \
  apps/parent/dist apps/dashboard/dist; then
  printf 'Development credential code leaked into a production bundle.\n' >&2
  exit 1
else
  search_status="$?"
  if [[ "$search_status" -ne 1 ]]; then
    printf 'Production bundle marker scan could not be completed.\n' >&2
    exit "$search_status"
  fi
fi

node scripts/verify-public-source-privacy.mjs
node scripts/verify-no-credential-leaks.mjs
node scripts/verify-no-github-credentials.mjs
printf 'Production bundles contain no development credential markers, generated access tokens, GitHub credentials, or public-source privacy findings.\n'

#!/usr/bin/env bash

set -euo pipefail

if [[ "${NODE_ENV:-development}" == 'production' ]]; then
  printf 'Development household seed is disabled in production.\n' >&2
  exit 1
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${DEVELOPMENT_AUTH_SECRET:?DEVELOPMENT_AUTH_SECRET is required}"
: "${DEV_PARENT_API_ORIGIN:?DEV_PARENT_API_ORIGIN is required}"
: "${DEV_DASHBOARD_API_ORIGIN:?DEV_DASHBOARD_API_ORIGIN is required}"

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(dirname "$script_directory")"

cd "$repository_root"
pnpm --filter @family/contracts build
pnpm --filter @family/api build
node apps/api/dist/dev/seed-cli.js

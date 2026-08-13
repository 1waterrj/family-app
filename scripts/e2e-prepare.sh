#!/usr/bin/env bash

set -euo pipefail
umask 077

if [[ "${NODE_ENV:-development}" == 'production' ]]; then
  printf 'Local E2E preparation is disabled in production.\n' >&2
  exit 1
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(dirname "$script_directory")"
runtime_directory="$repository_root/.local"
runtime_path="$runtime_directory/e2e-runtime.json"
artifact_directory="$runtime_directory/e2e-artifacts"
database_url='postgres://family:family@127.0.0.1:54329/family'
parent_api_origin='http://127.0.0.1:5173'
dashboard_api_origin='http://127.0.0.1:5173'
development_auth_secret="$(openssl rand -hex 48)"

cd "$repository_root"
if [[ -L "$runtime_directory" ]]; then
  printf 'Refusing to write the E2E runtime through a linked .local directory.\n' >&2
  exit 1
fi
mkdir -p "$runtime_directory"
chmod 700 "$runtime_directory"
if [[ "$(cd "$runtime_directory" && pwd -P)" != "$runtime_directory" ]]; then
  printf 'Refusing to write the E2E runtime outside the repository .local directory.\n' >&2
  exit 1
fi
if [[ -L "$artifact_directory" ]]; then
  printf 'Refusing to write E2E artifacts through a linked directory.\n' >&2
  exit 1
fi
mkdir -p "$artifact_directory"
chmod 700 "$artifact_directory"
if [[ "$(cd "$artifact_directory" && pwd -P)" != "$artifact_directory" ]]; then
  printf 'Refusing to write E2E artifacts outside the repository .local directory.\n' >&2
  exit 1
fi

./scripts/dev-db.sh start >/dev/null
database_ready='false'
for _ in {1..120}; do
  if docker exec family-app-postgres pg_isready -U family -d family >/dev/null 2>&1; then
    database_ready='true'
    break
  fi
  sleep 0.25
done
if [[ "$database_ready" != 'true' ]]; then
  printf 'The named family-app-postgres container did not become ready.\n' >&2
  exit 1
fi

export NODE_ENV=development
export DATABASE_URL="$database_url"
export DEVELOPMENT_AUTH_SECRET="$development_auth_secret"
export DEV_PARENT_API_ORIGIN="$parent_api_origin"
export DEV_DASHBOARD_API_ORIGIN="$dashboard_api_origin"

pnpm --filter @family/api db:migrate
pnpm --filter @family/api-client build
pnpm dev:seed

runtime_temporary_path="$(mktemp "$runtime_directory/e2e-runtime.XXXXXX")"
export FAMILY_E2E_RUNTIME_TEMPORARY_PATH="$runtime_temporary_path"
node --input-type=module --eval '
  import { writeFileSync } from "node:fs";
  writeFileSync(
    process.env.FAMILY_E2E_RUNTIME_TEMPORARY_PATH,
    `${JSON.stringify({
      databaseUrl: process.env.DATABASE_URL,
      developmentAuthSecret: process.env.DEVELOPMENT_AUTH_SECRET,
      parentApiOrigin: process.env.DEV_PARENT_API_ORIGIN,
      dashboardApiOrigin: process.env.DEV_DASHBOARD_API_ORIGIN,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
'
chmod 600 "$runtime_temporary_path"
mv -f "$runtime_temporary_path" "$runtime_path"

node scripts/test-verify-e2e-artifact-security.mjs
node scripts/verify-e2e-artifact-security.mjs

printf 'Local E2E database, fixtures, runtime, and artifact storage are ready.\n'

#!/usr/bin/env bash

set -euo pipefail

shared_build_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shared_build_repository_root="$(cd "$shared_build_script_directory/.." && pwd)"

cd "$shared_build_repository_root"

pnpm --filter @family/contracts build
pnpm --filter @family/api-client build
pnpm --filter @family/chore-images build
pnpm --filter @family/design-tokens build

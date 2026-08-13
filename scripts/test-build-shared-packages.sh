#!/usr/bin/env bash

set -euo pipefail

shared_test_script_directory="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shared_test_repository_root="$(cd -P "$shared_test_script_directory/.." && pwd)"
shared_test_packages=(contracts api-client chore-images design-tokens)
shared_test_targets=('')
shared_test_backups=('')
shared_test_states=('')
shared_test_had_original=('')
shared_test_backup_directory=''

shared_test_path_exists() {
  [[ -e "$1" || -L "$1" ]]
}

shared_test_validate_repository() {
  if [[ -z "$shared_test_repository_root" ||
    "$shared_test_repository_root" == / ||
    ! -f "$shared_test_repository_root/pnpm-workspace.yaml" ||
    ! -x "$shared_test_repository_root/scripts/build-shared-packages.sh" ]]; then
    printf 'Refusing unexpected shared-build repository root: %s\n' \
      "$shared_test_repository_root" >&2
    return 1
  fi
}

shared_test_validate_target() {
  shared_test_package="$1"
  shared_test_expected_target="$2"
  shared_test_parent="$shared_test_repository_root/packages/$shared_test_package"

  if [[ ! -d "$shared_test_parent" || -L "$shared_test_parent" ]]; then
    printf 'Refusing unsafe package parent: %s\n' "$shared_test_parent" >&2
    return 1
  fi
  shared_test_physical_parent="$(cd -P "$shared_test_parent" && pwd)"
  if [[ "$shared_test_physical_parent" != "$shared_test_parent" ||
    "$shared_test_expected_target" != "$shared_test_parent/dist" ]]; then
    printf 'Refusing package target outside its physical parent: %s\n' \
      "$shared_test_expected_target" >&2
    return 1
  fi
  case "$shared_test_expected_target" in
    "$shared_test_repository_root"/packages/contracts/dist | \
      "$shared_test_repository_root"/packages/api-client/dist | \
      "$shared_test_repository_root"/packages/chore-images/dist | \
      "$shared_test_repository_root"/packages/design-tokens/dist) ;;
    *)
      printf 'Refusing non-enumerated shared-build target: %s\n' \
        "$shared_test_expected_target" >&2
      return 1
      ;;
  esac
}

shared_test_cleanup() {
  shared_test_command_status=$?
  trap - EXIT INT TERM HUP
  shared_test_cleanup_failed=false

  for shared_test_index in 1 2 3 4; do
    shared_test_state="${shared_test_states[$shared_test_index]:-unmanaged}"
    [[ "$shared_test_state" != unmanaged ]] || continue
    shared_test_package="${shared_test_packages[$((shared_test_index - 1))]}"
    shared_test_target="${shared_test_targets[$shared_test_index]}"
    shared_test_backup="${shared_test_backups[$shared_test_index]}"
    shared_test_target_exists=false
    shared_test_backup_exists=false

    shared_test_path_exists "$shared_test_target" && \
      shared_test_target_exists=true
    shared_test_path_exists "$shared_test_backup" && \
      shared_test_backup_exists=true

    if ! shared_test_validate_target "$shared_test_package" "$shared_test_target"; then
      shared_test_cleanup_failed=true
      continue
    fi

    if [[ "$shared_test_state" == backup-in-progress ]]; then
      if [[ "$shared_test_target_exists" == true &&
        "$shared_test_backup_exists" == false ]]; then
        continue
      elif [[ "$shared_test_target_exists" == false &&
        "$shared_test_backup_exists" == true ]]; then
        if [[ -L "$shared_test_backup" || ! -d "$shared_test_backup" ]]; then
          printf 'Refusing changed interrupted shared-build backup: %s\n' \
            "$shared_test_backup" >&2
          shared_test_cleanup_failed=true
        elif ! mv -- "$shared_test_backup" "$shared_test_target"; then
          printf 'Could not restore interrupted shared-build backup: %s\n' \
            "$shared_test_target" >&2
          shared_test_cleanup_failed=true
        elif shared_test_path_exists "$shared_test_backup" ||
          [[ ! -d "$shared_test_target" || -L "$shared_test_target" ]]; then
          printf 'Could not verify interrupted shared-build restoration: %s\n' \
            "$shared_test_target" >&2
          shared_test_cleanup_failed=true
        fi
      elif [[ "$shared_test_target_exists" == true &&
        "$shared_test_backup_exists" == true ]]; then
        printf 'Refusing ambiguous interrupted shared-build backup; both paths exist: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
      else
        printf 'Interrupted shared-build backup lost both paths: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
      fi
      continue
    fi

    if [[ "$shared_test_state" == prepared ]]; then
      if [[ "$shared_test_target_exists" == true ]]; then
        printf 'Refusing unexpected shared-build target before build: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
        continue
      fi
    elif [[ "$shared_test_state" == build-managed &&
      "$shared_test_target_exists" == true ]]; then
      if [[ -L "$shared_test_target" || ! -d "$shared_test_target" ]]; then
        printf 'Refusing to remove changed shared-build target: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
        continue
      fi
      if ! rm -rf -- "$shared_test_target" ||
        shared_test_path_exists "$shared_test_target"; then
        printf 'Could not remove generated shared-build target: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
        continue
      fi
    fi

    if [[ "${shared_test_had_original[$shared_test_index]:-false}" == true ]]; then
      if [[ "$shared_test_backup_exists" != true ]]; then
        printf 'Original shared-build backup is missing: %s\n' \
          "$shared_test_backup" >&2
        shared_test_cleanup_failed=true
      elif [[ -L "$shared_test_backup" || ! -d "$shared_test_backup" ]]; then
        printf 'Refusing changed original shared-build backup: %s\n' \
          "$shared_test_backup" >&2
        shared_test_cleanup_failed=true
      elif ! mv -- "$shared_test_backup" "$shared_test_target"; then
        printf 'Could not restore original shared-build target: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
      elif shared_test_path_exists "$shared_test_backup" ||
        [[ ! -d "$shared_test_target" || -L "$shared_test_target" ]]; then
        printf 'Could not verify restored shared-build target: %s\n' \
          "$shared_test_target" >&2
        shared_test_cleanup_failed=true
      fi
    elif [[ "$shared_test_backup_exists" == true ]]; then
      printf 'Refusing unexpected shared-build backup: %s\n' \
        "$shared_test_backup" >&2
      shared_test_cleanup_failed=true
    fi
  done

  if [[ "$shared_test_cleanup_failed" != true &&
    -n "$shared_test_backup_directory" ]]; then
    if ! rmdir -- "$shared_test_backup_directory" ||
      shared_test_path_exists "$shared_test_backup_directory"; then
      printf 'Could not remove completed shared-build backup: %s\n' \
        "$shared_test_backup_directory" >&2
      shared_test_cleanup_failed=true
    fi
  fi

  if [[ "$shared_test_cleanup_failed" == true ]]; then
    printf 'Shared-build cleanup failed; recovery artifacts remain at: %s\n' \
      "$shared_test_backup_directory" >&2
    exit 1
  fi
  exit "$shared_test_command_status"
}

shared_test_validate_repository

shared_test_backup_parent="$(cd -P "${TMPDIR:-/tmp}" && pwd)"
if [[ -z "$shared_test_backup_parent" || "$shared_test_backup_parent" == / ||
  ! -d "$shared_test_backup_parent" ]]; then
  printf 'Refusing unexpected shared-build backup parent: %s\n' \
    "$shared_test_backup_parent" >&2
  exit 1
fi
shared_test_backup_directory="$(
  mktemp -d "$shared_test_backup_parent/family-shared-build.XXXXXX"
)"
trap shared_test_cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

shared_test_physical_backup_directory="$(
  cd -P "$shared_test_backup_directory" && pwd
)"
case "$shared_test_physical_backup_directory" in
  "$shared_test_backup_parent"/family-shared-build.*) ;;
  *)
    printf 'Refusing unexpected shared-build backup directory: %s\n' \
      "$shared_test_physical_backup_directory" >&2
    exit 1
    ;;
esac
shared_test_backup_directory="$shared_test_physical_backup_directory"

for shared_test_index in 1 2 3 4; do
  shared_test_package="${shared_test_packages[$((shared_test_index - 1))]}"
  shared_test_target="$shared_test_repository_root/packages/$shared_test_package/dist"
  shared_test_backup="$shared_test_backup_directory/$shared_test_package-dist"
  shared_test_targets+=("$shared_test_target")
  shared_test_backups+=("$shared_test_backup")
  shared_test_states+=(unmanaged)
  shared_test_had_original+=(false)

  shared_test_validate_target "$shared_test_package" "$shared_test_target"
  if [[ -L "$shared_test_target" ||
    -e "$shared_test_target" && ! -d "$shared_test_target" ]]; then
    printf 'Refusing unsafe shared-build output: %s\n' "$shared_test_target" >&2
    exit 1
  fi
  if shared_test_path_exists "$shared_test_backup"; then
    printf 'Refusing occupied shared-build backup target: %s\n' \
      "$shared_test_backup" >&2
    exit 1
  fi

  if [[ -d "$shared_test_target" ]]; then
    shared_test_had_original[$shared_test_index]=true
    shared_test_states[$shared_test_index]=backup-in-progress
    if ! mv -- "$shared_test_target" "$shared_test_backup"; then
      printf 'Could not back up shared-build output: %s\n' \
        "$shared_test_target" >&2
      exit 1
    fi
  fi

  if shared_test_path_exists "$shared_test_target" ||
    [[ "${shared_test_had_original[$shared_test_index]}" == true &&
      ! -d "$shared_test_backup" ]]; then
    printf 'Could not verify clean shared-build start for: %s\n' \
      "$shared_test_target" >&2
    exit 1
  fi
  shared_test_states[$shared_test_index]=prepared
done

for shared_test_index in 1 2 3 4; do
  shared_test_states[$shared_test_index]=build-managed
done

cd "$shared_test_repository_root"
./scripts/build-shared-packages.sh

pnpm --filter @family/dashboard exec node --input-type=module -e '
  import { existsSync } from "node:fs";
  import { fileURLToPath } from "node:url";

  const runtimeExports = [
    "@family/contracts",
    "@family/api-client",
    "@family/api-client/development-credential",
    "@family/chore-images",
    "@family/design-tokens",
  ];
  const assetExports = [
    "dishes.png",
    "feed-pet.png",
    "help-garden.png",
    "laundry.png",
    "make-bed.png",
    "set-table.png",
    "tidy-toys.png",
    "wipe-counter.png",
  ].map((asset) => `@family/chore-images/assets/${asset}`);

  for (const packageExport of [...runtimeExports, ...assetExports]) {
    const resolved = import.meta.resolve(packageExport);
    if (!resolved.startsWith("file:") || !existsSync(fileURLToPath(resolved))) {
      throw new Error(`Package export did not resolve to a file: ${packageExport}`);
    }
  }
  for (const packageExport of runtimeExports) {
    await import(packageExport);
  }
'

if [[ "${FAMILY_SHARED_BUILD_TEST_INDUCE_FAILURE:-}" == after-build ]]; then
  printf 'Inducing requested post-build failure after real export verification.\n' >&2
  exit 97
elif [[ -n "${FAMILY_SHARED_BUILD_TEST_INDUCE_FAILURE:-}" ]]; then
  printf 'Refusing unknown shared-build failure point: %s\n' \
    "$FAMILY_SHARED_BUILD_TEST_INDUCE_FAILURE" >&2
  exit 1
fi

pnpm --filter @family/dashboard exec vitest run --config vitest.config.ts \
  test/pwa-config.test.ts test/setup-screen.test.tsx \
  test/family-home-screen.test.tsx

printf 'PASS: real clean shared builds resolve every client export and dashboard Vite imports\n'

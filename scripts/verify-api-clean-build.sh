#!/usr/bin/env bash

set -euo pipefail

task8_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task8_repository_root="$(cd "$task8_script_directory/.." && pwd)"
task8_contracts_dist="$task8_repository_root/packages/contracts/dist"
task8_backup_attempted=false
task8_original_dist_backed_up=false

case "$task8_contracts_dist" in
  "$task8_repository_root/packages/contracts/dist") ;;
  *)
    printf 'Refusing to move unexpected contracts output: %s\n' \
      "$task8_contracts_dist" >&2
    exit 1
    ;;
esac

task8_backup_parent="$(cd "${TASK8_CLEAN_BUILD_TMPDIR:-${TMPDIR:-/tmp}}" && pwd)"
if [[ ! -d "$task8_backup_parent" || -L "$task8_backup_parent" ]] ||
  [[ -z "$task8_backup_parent" || "$task8_backup_parent" == / ]]; then
  printf 'Refusing to use unexpected backup parent: %s\n' \
    "$task8_backup_parent" >&2
  exit 1
fi

task8_backup_directory="$(
  mktemp -d "$task8_backup_parent/family-api-clean-build.XXXXXX"
)"
case "$task8_backup_directory" in
  "$task8_backup_parent"/family-api-clean-build.*) ;;
  *)
    printf 'Refusing to use unexpected backup directory: %s\n' \
      "$task8_backup_directory" >&2
    exit 1
    ;;
esac
if [[ ! -d "$task8_backup_directory" || -L "$task8_backup_directory" ]]; then
  printf 'Refusing to use unexpected backup directory: %s\n' \
    "$task8_backup_directory" >&2
  exit 1
fi

task8_path_exists() {
  [[ -e "$1" || -L "$1" ]]
}

restore_contracts_dist() {
  task8_command_status=$?
  trap - EXIT
  task8_cleanup_failed=false
  task8_cleanup_failure_reason=''
  task8_final_generated_dist="$task8_backup_directory/final-generated-dist"
  task8_original_backup="$task8_backup_directory/original-dist"

  if [[ "$task8_backup_attempted" == true ]] &&
    [[ "$task8_original_dist_backed_up" != true ]]; then
    task8_cleanup_failed=true
    task8_cleanup_failure_reason='the original contracts output was not safely backed up'
  fi

  if [[ "$task8_cleanup_failed" != true ]] &&
    task8_path_exists "$task8_contracts_dist"; then
    if task8_path_exists "$task8_final_generated_dist"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the generated-output recovery target already exists'
    elif ! mv "$task8_contracts_dist" "$task8_final_generated_dist"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the generated contracts output could not be relocated'
    elif task8_path_exists "$task8_contracts_dist" ||
      ! task8_path_exists "$task8_final_generated_dist"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the generated contracts output relocation could not be verified'
    fi
  fi

  if [[ "$task8_cleanup_failed" != true ]] &&
    [[ "$task8_original_dist_backed_up" == true ]]; then
    if task8_path_exists "$task8_contracts_dist"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the contracts output path was not cleared before restoration'
    elif ! task8_path_exists "$task8_original_backup"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the original contracts output backup is missing'
    elif ! mv "$task8_original_backup" "$task8_contracts_dist"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the original contracts output could not be restored'
    elif task8_path_exists "$task8_original_backup" ||
      ! task8_path_exists "$task8_contracts_dist"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the original contracts output restoration could not be verified'
    fi
  fi

  if [[ "$task8_cleanup_failed" != true ]]; then
    if ! rm -rf "$task8_backup_directory"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the completed artifact backup could not be removed'
    elif task8_path_exists "$task8_backup_directory"; then
      task8_cleanup_failed=true
      task8_cleanup_failure_reason='the completed artifact backup removal could not be verified'
    fi
  fi

  if [[ "$task8_cleanup_failed" == true ]]; then
    printf 'Artifact cleanup failed: %s.\n' \
      "$task8_cleanup_failure_reason" >&2
    printf 'Artifact recovery directory preserved at: %s\n' \
      "$task8_backup_directory" >&2
    exit 1
  fi

  exit "$task8_command_status"
}
trap restore_contracts_dist EXIT

if task8_path_exists "$task8_contracts_dist"; then
  task8_backup_attempted=true
  if ! mv "$task8_contracts_dist" "$task8_backup_directory/original-dist"; then
    printf 'Failed to back up the original contracts output.\n' >&2
    exit 1
  fi
  if task8_path_exists "$task8_contracts_dist" ||
    ! task8_path_exists "$task8_backup_directory/original-dist"; then
    printf 'Could not verify the original contracts output backup.\n' >&2
    exit 1
  fi
  task8_original_dist_backed_up=true
fi

cd "$task8_repository_root"
pnpm --filter @family/api build

if ! mv "$task8_contracts_dist" "$task8_backup_directory/build-generated-dist"; then
  printf 'Failed to archive the standalone API build contracts output.\n' >&2
  exit 1
fi
pnpm --filter @family/api typecheck

printf 'Standalone API build and typecheck succeeded without pre-existing contracts output.\n'

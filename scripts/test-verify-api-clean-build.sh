#!/usr/bin/env bash

set -euo pipefail

test_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${0##*/}" == mv ]]; then
  test_mv_source="${1-}"
  test_mv_destination="${2-}"

  case "${TASK8_TEST_MV_FAILURE-}" in
    backup)
      if [[ "${test_mv_destination##*/}" == original-dist ]]; then
        exit 73
      fi
      ;;
    generated-cleanup)
      if [[ "${test_mv_destination##*/}" == final-generated-dist ]]; then
        exit 74
      fi
      ;;
    restore)
      if [[ "${test_mv_source##*/}" == original-dist ]] &&
        [[ "$test_mv_destination" == "$TASK8_TEST_REPOSITORY_ROOT/packages/contracts/dist" ]]; then
        exit 75
      fi
      ;;
  esac

  exec /bin/mv "$@"
fi

if [[ "${0##*/}" == pnpm ]]; then
  mkdir -p "$TASK8_TEST_REPOSITORY_ROOT/packages/contracts/dist"
  printf '%s\n' "$*" > \
    "$TASK8_TEST_REPOSITORY_ROOT/packages/contracts/dist/generated-marker"
  exit 0
fi

test_workspace="$(mktemp -d)"
test_shim_directory="$test_workspace/shims"
mkdir -p "$test_shim_directory"
ln -s "$test_script_directory/test-verify-api-clean-build.sh" \
  "$test_shim_directory/mv"
ln -s "$test_script_directory/test-verify-api-clean-build.sh" \
  "$test_shim_directory/pnpm"

cleanup_test_workspace() {
  rm -rf "$test_workspace"
}
trap cleanup_test_workspace EXIT

fail_test() {
  printf 'FAIL: %s\n' "$1" >&2
  return 1
}

recovery_path_from_output() {
  sed -n 's/^Artifact recovery directory preserved at: //p' <<< "$1" | tail -n 1
}

run_case() {
  test_case="$1"
  test_repository="$test_workspace/$test_case/repository"
  test_recovery_parent="$test_workspace/$test_case/recovery"
  mkdir -p \
    "$test_repository/scripts" \
    "$test_repository/packages/contracts/dist" \
    "$test_recovery_parent"
  cp "$test_script_directory/verify-api-clean-build.sh" \
    "$test_repository/scripts/verify-api-clean-build.sh"
  printf 'original\n' > \
    "$test_repository/packages/contracts/dist/original-marker"

  set +e
  test_output="$({
    cd "$test_repository"
    PATH="$test_shim_directory:$PATH" \
      TASK8_CLEAN_BUILD_TMPDIR="$test_recovery_parent" \
      TASK8_TEST_MV_FAILURE="$test_case" \
      TASK8_TEST_REPOSITORY_ROOT="$test_repository" \
      ./scripts/verify-api-clean-build.sh
  } 2>&1)"
  test_status=$?
  set -e

  case "$test_case" in
    success)
      [[ "$test_status" -eq 0 ]] ||
        fail_test "success case exited $test_status: $test_output"
      [[ -f "$test_repository/packages/contracts/dist/original-marker" ]] ||
        fail_test 'success case did not restore the original contracts output'
      [[ ! -f "$test_repository/packages/contracts/dist/generated-marker" ]] ||
        fail_test 'success case left generated output at the contracts path'
      [[ -z "$(find "$test_recovery_parent" -mindepth 1 -print -quit)" ]] ||
        fail_test 'success case did not remove its completed backup'
      ;;
    backup)
      [[ "$test_status" -ne 0 ]] ||
        fail_test 'backup failure exited successfully'
      [[ -f "$test_repository/packages/contracts/dist/original-marker" ]] ||
        fail_test 'backup failure moved or deleted the original contracts output'
      test_recovery_path="$(recovery_path_from_output "$test_output")"
      [[ -n "$test_recovery_path" && -d "$test_recovery_path" ]] ||
        fail_test "backup failure did not preserve and report its recovery path: $test_output"
      [[ "$test_recovery_path" == "$test_recovery_parent/"* ]] ||
        fail_test "backup failure reported an unexpected recovery path: $test_recovery_path"
      ;;
    generated-cleanup)
      [[ "$test_status" -ne 0 ]] ||
        fail_test 'generated-output cleanup failure exited successfully'
      test_recovery_path="$(recovery_path_from_output "$test_output")"
      [[ -n "$test_recovery_path" && -d "$test_recovery_path" ]] ||
        fail_test "cleanup failure did not preserve and report its recovery path: $test_output"
      [[ -f "$test_recovery_path/original-dist/original-marker" ]] ||
        fail_test "cleanup failure did not preserve the original backup: $test_output"
      [[ -f "$test_repository/packages/contracts/dist/generated-marker" ]] ||
        fail_test 'cleanup failure deleted the generated output after relocation failed'
      [[ ! -e "$test_repository/packages/contracts/dist/original-dist" ]] ||
        fail_test 'cleanup failure nested the original output under generated output'
      ;;
    restore)
      [[ "$test_status" -ne 0 ]] ||
        fail_test 'restoration failure exited successfully'
      test_recovery_path="$(recovery_path_from_output "$test_output")"
      [[ -n "$test_recovery_path" && -d "$test_recovery_path" ]] ||
        fail_test "restoration failure did not preserve and report its recovery path: $test_output"
      [[ -f "$test_recovery_path/original-dist/original-marker" ]] ||
        fail_test "restoration failure did not preserve the original backup: $test_output"
      [[ -f "$test_recovery_path/final-generated-dist/generated-marker" ]] ||
        fail_test 'restoration failure did not preserve the generated output'
      [[ ! -e "$test_repository/packages/contracts/dist" ]] ||
        fail_test 'restoration failure left an occupied contracts output path'
      ;;
    *)
      fail_test "unknown test case: $test_case"
      ;;
  esac

  printf 'PASS: %s\n' "$test_case"
}

if [[ "$#" -gt 0 ]]; then
  test_cases=("$@")
else
  test_cases=(success backup generated-cleanup restore)
fi

for test_case in "${test_cases[@]}"; do
  run_case "$test_case"
done

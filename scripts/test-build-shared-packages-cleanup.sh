#!/usr/bin/env bash

set -euo pipefail

cleanup_test_script_directory="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cleanup_test_repository_root="$(cd -P "$cleanup_test_script_directory/.." && pwd)"
cleanup_test_sentinel_name='.family-shared-build-cleanup-sentinel'
cleanup_test_created_targets=('')
cleanup_test_touched_targets=('')
cleanup_test_signal_workspace=''

cleanup_test_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

cleanup_test_path_exists() {
  [[ -e "$1" || -L "$1" ]]
}

cleanup_test_finish() {
  cleanup_test_status=$?
  trap - EXIT INT TERM HUP
  cleanup_test_cleanup_failed=false

  if [[ -n "$cleanup_test_signal_workspace" ]]; then
    case "$cleanup_test_signal_workspace" in
      "${TMPDIR:-/tmp}"/family-shared-build-signal-test.*)
        rm -rf -- "$cleanup_test_signal_workspace" || \
          cleanup_test_cleanup_failed=true
        ;;
      *)
        printf 'Refusing unexpected signal-test workspace: %s\n' \
          "$cleanup_test_signal_workspace" >&2
        cleanup_test_cleanup_failed=true
        ;;
    esac
  fi

  for cleanup_test_target in "${cleanup_test_touched_targets[@]}"; do
    [[ -n "$cleanup_test_target" ]] || continue
    cleanup_test_sentinel="$cleanup_test_target/$cleanup_test_sentinel_name"
    cleanup_test_mode_fixture="$cleanup_test_sentinel.mode"
    if [[ -f "$cleanup_test_sentinel" && ! -L "$cleanup_test_sentinel" ]]; then
      rm -- "$cleanup_test_sentinel" || cleanup_test_cleanup_failed=true
    elif cleanup_test_path_exists "$cleanup_test_sentinel"; then
      printf 'Cleanup self-test left an unsafe sentinel at %s\n' \
        "$cleanup_test_sentinel" >&2
      cleanup_test_cleanup_failed=true
    fi
    if [[ -f "$cleanup_test_mode_fixture" && ! -L "$cleanup_test_mode_fixture" ]]; then
      rm -- "$cleanup_test_mode_fixture" || cleanup_test_cleanup_failed=true
    elif cleanup_test_path_exists "$cleanup_test_mode_fixture"; then
      printf 'Cleanup self-test left an unsafe mode fixture at %s\n' \
        "$cleanup_test_mode_fixture" >&2
      cleanup_test_cleanup_failed=true
    fi
  done

  for cleanup_test_target in "${cleanup_test_created_targets[@]}"; do
    [[ -n "$cleanup_test_target" ]] || continue
    if [[ -d "$cleanup_test_target" && ! -L "$cleanup_test_target" ]]; then
      if ! rmdir -- "$cleanup_test_target"; then
        printf 'Cleanup self-test refused to remove non-empty target: %s\n' \
          "$cleanup_test_target" >&2
        cleanup_test_cleanup_failed=true
      fi
    elif cleanup_test_path_exists "$cleanup_test_target"; then
      printf 'Cleanup self-test target changed identity: %s\n' \
        "$cleanup_test_target" >&2
      cleanup_test_cleanup_failed=true
    fi
  done

  if [[ "$cleanup_test_cleanup_failed" == true ]]; then
    exit 1
  fi
  exit "$cleanup_test_status"
}

trap cleanup_test_finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "$cleanup_test_repository_root" || "$cleanup_test_repository_root" == / ]] ||
  [[ ! -f "$cleanup_test_repository_root/pnpm-workspace.yaml" ]]; then
  printf 'Refusing unexpected cleanup-test repository root: %s\n' \
    "$cleanup_test_repository_root" >&2
  exit 1
fi

cleanup_test_signal_workspace="$(
  mktemp -d "${TMPDIR:-/tmp}/family-shared-build-signal-test.XXXXXX"
)"
cleanup_test_signal_repository="$cleanup_test_signal_workspace/repository"
cleanup_test_signal_shims="$cleanup_test_signal_workspace/shims"
cleanup_test_signal_tmp="$cleanup_test_signal_workspace/tmp"
mkdir -p -- \
  "$cleanup_test_signal_repository/scripts" \
  "$cleanup_test_signal_shims" \
  "$cleanup_test_signal_tmp"
cp -- "$cleanup_test_script_directory/test-build-shared-packages.sh" \
  "$cleanup_test_signal_repository/scripts/test-build-shared-packages.sh"
printf 'packages:\n  - packages/*\n' > \
  "$cleanup_test_signal_repository/pnpm-workspace.yaml"
printf '#!/usr/bin/env bash\nexit 88\n' > \
  "$cleanup_test_signal_repository/scripts/build-shared-packages.sh"
chmod +x "$cleanup_test_signal_repository/scripts/build-shared-packages.sh"

for cleanup_test_package in contracts api-client chore-images design-tokens; do
  cleanup_test_signal_target="$cleanup_test_signal_repository/packages/$cleanup_test_package/dist"
  mkdir -p -- "$cleanup_test_signal_target"
  chmod 751 "$cleanup_test_signal_target"
  printf 'signal-restore-%s\n' "$cleanup_test_package" > \
    "$cleanup_test_signal_target/original.txt"
  chmod 640 "$cleanup_test_signal_target/original.txt"
done

cleanup_test_real_mv="$(command -v mv)"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if mkdir "$FAMILY_SIGNAL_TEST_ONCE" 2>/dev/null; then' \
  '  "$FAMILY_SIGNAL_TEST_REAL_MV" "$@"' \
  '  kill -TERM "$PPID"' \
  '  exit 0' \
  'fi' \
  'exec "$FAMILY_SIGNAL_TEST_REAL_MV" "$@"' > \
  "$cleanup_test_signal_shims/mv"
chmod +x "$cleanup_test_signal_shims/mv"

set +e
PATH="$cleanup_test_signal_shims:$PATH" \
  TMPDIR="$cleanup_test_signal_tmp" \
  FAMILY_SIGNAL_TEST_REAL_MV="$cleanup_test_real_mv" \
  FAMILY_SIGNAL_TEST_ONCE="$cleanup_test_signal_workspace/mv-triggered" \
  "$cleanup_test_signal_repository/scripts/test-build-shared-packages.sh"
cleanup_test_signal_status=$?
set -e

if [[ "$cleanup_test_signal_status" -ne 143 ]]; then
  printf 'Expected signal-timing status 143, received %s\n' \
    "$cleanup_test_signal_status" >&2
  exit 1
fi
for cleanup_test_package in contracts api-client chore-images design-tokens; do
  cleanup_test_signal_target="$cleanup_test_signal_repository/packages/$cleanup_test_package/dist"
  cleanup_test_signal_original="$cleanup_test_signal_target/original.txt"
  [[ -f "$cleanup_test_signal_original" && ! -L "$cleanup_test_signal_original" ]] || {
    printf 'Signal-timing cleanup did not restore %s\n' \
      "$cleanup_test_package" >&2
    exit 1
  }
  [[ "$(<"$cleanup_test_signal_original")" == \
    "signal-restore-$cleanup_test_package" ]] || {
    printf 'Signal-timing cleanup changed %s content\n' \
      "$cleanup_test_package" >&2
    exit 1
  }
  [[ "$(cleanup_test_mode "$cleanup_test_signal_original")" == 640 ]] || {
    printf 'Signal-timing cleanup changed %s file mode\n' \
      "$cleanup_test_package" >&2
    exit 1
  }
  [[ "$(cleanup_test_mode "$cleanup_test_signal_target")" == 751 ]] || {
    printf 'Signal-timing cleanup changed %s directory mode\n' \
      "$cleanup_test_package" >&2
    exit 1
  }
done
if find "$cleanup_test_signal_tmp" -mindepth 1 -print -quit | grep -q .; then
  printf 'Signal-timing cleanup left a recovery directory behind\n' >&2
  exit 1
fi

printf 'PASS: signal after backup move restored original content and modes\n'

cleanup_test_packages=(contracts api-client chore-images design-tokens)
for cleanup_test_package in "${cleanup_test_packages[@]}"; do
  cleanup_test_parent="$cleanup_test_repository_root/packages/$cleanup_test_package"
  cleanup_test_physical_parent="$(cd -P "$cleanup_test_parent" && pwd)"
  if [[ "$cleanup_test_physical_parent" != "$cleanup_test_parent" ]]; then
    printf 'Refusing non-physical package parent: %s\n' "$cleanup_test_parent" >&2
    exit 1
  fi

  cleanup_test_target="$cleanup_test_parent/dist"
  if [[ -L "$cleanup_test_target" ]] ||
    [[ -e "$cleanup_test_target" && ! -d "$cleanup_test_target" ]]; then
    printf 'Refusing unsafe cleanup-test target: %s\n' "$cleanup_test_target" >&2
    exit 1
  fi
  if [[ ! -d "$cleanup_test_target" ]]; then
    cleanup_test_created_targets+=("$cleanup_test_target")
    mkdir -- "$cleanup_test_target"
    chmod 751 "$cleanup_test_target"
  fi
  cleanup_test_touched_targets+=("$cleanup_test_target")
  cleanup_test_original_mode="$(cleanup_test_mode "$cleanup_test_target")"
  if cleanup_test_path_exists \
    "$cleanup_test_target/$cleanup_test_sentinel_name" ||
    cleanup_test_path_exists \
      "$cleanup_test_target/$cleanup_test_sentinel_name.mode"; then
    printf 'Refusing occupied cleanup self-test sentinel in: %s\n' \
      "$cleanup_test_target" >&2
    exit 1
  fi
  printf 'restore-%s\n' "$cleanup_test_package" > \
    "$cleanup_test_target/$cleanup_test_sentinel_name"
  chmod 640 "$cleanup_test_target/$cleanup_test_sentinel_name"
  printf '%s\n' "$cleanup_test_original_mode" > \
    "$cleanup_test_target/$cleanup_test_sentinel_name.mode"
done

set +e
FAMILY_SHARED_BUILD_TEST_INDUCE_FAILURE=after-build \
  "$cleanup_test_script_directory/test-build-shared-packages.sh"
cleanup_test_induced_status=$?
set -e

if [[ "$cleanup_test_induced_status" -ne 97 ]]; then
  printf 'Expected induced post-build failure status 97, received %s\n' \
    "$cleanup_test_induced_status" >&2
  exit 1
fi

for cleanup_test_package in "${cleanup_test_packages[@]}"; do
  cleanup_test_target="$cleanup_test_repository_root/packages/$cleanup_test_package/dist"
  cleanup_test_sentinel="$cleanup_test_target/$cleanup_test_sentinel_name"
  cleanup_test_expected_mode_file="$cleanup_test_sentinel.mode"
  [[ -f "$cleanup_test_sentinel" && ! -L "$cleanup_test_sentinel" ]] || {
    printf 'Sentinel was not restored for %s\n' "$cleanup_test_package" >&2
    exit 1
  }
  [[ "$(<"$cleanup_test_sentinel")" == "restore-$cleanup_test_package" ]] || {
    printf 'Sentinel content changed for %s\n' "$cleanup_test_package" >&2
    exit 1
  }
  [[ "$(cleanup_test_mode "$cleanup_test_sentinel")" == 640 ]] || {
    printf 'Sentinel mode changed for %s\n' "$cleanup_test_package" >&2
    exit 1
  }
  [[ -f "$cleanup_test_expected_mode_file" ]] || {
    printf 'Directory mode fixture is missing for %s\n' "$cleanup_test_package" >&2
    exit 1
  }
  [[ "$(cleanup_test_mode "$cleanup_test_target")" == \
    "$(<"$cleanup_test_expected_mode_file")" ]] || {
    printf 'Directory mode changed for %s\n' "$cleanup_test_package" >&2
    exit 1
  }
  rm -- "$cleanup_test_expected_mode_file"
done

printf 'PASS: induced post-build failure restored every pre-existing sentinel\n'

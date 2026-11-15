#!/usr/bin/env bash

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

BASE="${BASE:-origin/main}"

run_step() {
  local step_name="$1"
  shift

  printf '\n==> %s\n' "$step_name"
  if "$@"; then
    printf 'PASS: %s\n' "$step_name"
  else
    local status=$?
    printf 'FAIL: %s (exit %s)\n' "$step_name" "$status" >&2
    exit "$status"
  fi
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    printf 'Required Node.js v26.7.0, but node was not found on PATH.\n' >&2
    return 127
  fi

  local actual_version
  if ! actual_version="$(node --version)"; then
    printf 'Could not read the Node.js version.\n' >&2
    return 1
  fi

  if [[ "$actual_version" != "v26.7.0" ]]; then
    printf 'Required Node.js v26.7.0; found %s.\n' "$actual_version" >&2
    return 1
  fi
}

run_step 'Node version v26.7.0' check_node_version
run_step 'pnpm build' pnpm build
run_step 'pnpm typecheck' pnpm typecheck
run_step 'pnpm --filter @molio/daemon test' pnpm --filter @molio/daemon test
run_step 'pnpm --filter @molio/web test' pnpm --filter @molio/web test
run_step "git diff --check ${BASE}..HEAD" git diff --check "${BASE}..HEAD"

printf '\nLocal gate passed.\n'

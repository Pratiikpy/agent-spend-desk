#!/usr/bin/env bash
# A clean-room run: clone this repository at its current commit into an empty folder, install, typecheck, run every test and `desk prove`, and write the log that
# docs/verification/clean-room/ keeps. It follows the README and nothing else, so what it finds is what a stranger would find.
#
#   scripts/clean-room.sh OUT.log [REPO]      REPO is a path or URL; the default is the repository this script is in.
#
# The log's first line is the commit. It holds no colour codes. The exit codes of the tests and of prove are written as lines, and the script exits with the first non-zero.
set -u
OUT="${1:?usage: scripts/clean-room.sh OUT.log [REPO]}"
REPO="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export NO_COLOR=1 FORCE_COLOR=0 CI=1
unset NVIDIA_API_KEY MODEL_API_KEY MODEL_BASE_URL NEMOTRON_MODEL SAMPLE_MODE

git clone --quiet "$REPO" "$WORK/clone" || exit 2
cd "$WORK/clone" || exit 2
{
  echo "HEAD $(git rev-parse --short HEAD)"
  npm install 2>&1 | tail -6
  if npx tsc --noEmit; then echo "TSC OK"; else echo "TSC FAILED"; fi
  npx vitest run 2>&1 | grep -E -A12 "Test Files|Tests  |FAIL|AssertionError" | sed 's/\x1b\[[0-9;]*m//g'
  echo "VITEST EXIT ${PIPESTATUS[0]}"
  npx tsx src/desk/cli.ts prove 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tr -d '\r'
  echo "PROVE EXIT ${PIPESTATUS[0]}"
} > "$OUT" 2>&1
grep -q "^TSC OK$" "$OUT" && grep -q "^VITEST EXIT 0$" "$OUT" && grep -q "^PROVE EXIT 0$" "$OUT"

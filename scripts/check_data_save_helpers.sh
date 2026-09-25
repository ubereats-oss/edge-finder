#!/usr/bin/env bash
set -euo pipefail

tmp="${TMPDIR:-/tmp}/data-save-helper-check-$$"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/work" "$tmp/staged" "$tmp/work/odds_history"
cp -R pipeline "$tmp/ledger_pipeline"

if [[ -n "${SIMULATE_MISSING_LEDGER_DEP:-}" ]]; then
  rm -f "$tmp/ledger_pipeline/${SIMULATE_MISSING_LEDGER_DEP}"
fi

(
  cd "$tmp/work"
  node "$tmp/ledger_pipeline/reapply_ledger_changes.js" protect-closing-odds "$tmp/staged"
)

echo "data save helper dependency check passed"

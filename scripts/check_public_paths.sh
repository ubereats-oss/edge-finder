#!/usr/bin/env bash
set -euo pipefail

patterns=$(mktemp)
trap 'rm -f -- "$patterns"' EXIT
awk '
  /^# BEGIN PROHIBITED PUBLIC PATHS$/ { starts++; in_block=1; next }
  /^# END PROHIBITED PUBLIC PATHS$/ { ends++; in_block=0; next }
  in_block {
    if ($0 !~ /^([[:space:]]*|#.*)$/) count++
    if ($0 == "/export_js_root.js") root_js_exporter = 1
    if ($0 == "/exportar_codigo.py") root_python_exporter = 1
    print
  }
  END {
    if (starts != 1 || ends != 1 || !count || !root_js_exporter || !root_python_exporter) exit 1
  }
' .gitignore > "$patterns"

if [[ -n "$(git ls-files --cached --ignored --exclude-from="$patterns")" ]]; then
  printf '::error::O checkout publico contem caminhos reservados ou saidas de auditoria.\n'
  exit 1
fi

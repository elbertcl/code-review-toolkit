#!/usr/bin/env bash
set -euo pipefail

revision="${1:-}"
output="${2:-}"
if [[ ! "$revision" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Serena revision must be an exact 40-character commit SHA" >&2
  exit 2
fi
if [[ -z "$output" ]]; then
  echo "status output path is required" >&2
  exit 2
fi

serena_home="${SERENA_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/code-review-toolkit/serena}"
status="unavailable"
reason="setup_missing"
if [[ "${SERENA_DISABLED:-0}" == "1" ]]; then
  status="disabled"
  reason="disabled_by_configuration"
elif [[ -x "$serena_home/bin/serena-readonly" && -f "$serena_home/revision" ]] && [[ "$(<"$serena_home/revision")" == "$revision" ]]; then
  status="available"
  reason="pinned_wrapper_ready"
fi

printf '{"schema_version":1,"status":"%s","revision":"%s","reason":"%s"}\n' \
  "$status" "$revision" "$reason" >"$output"
exit 0

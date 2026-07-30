#!/usr/bin/env bash
set -euo pipefail

revision="${1:-}"
workspace="${2:-$PWD}"
output="${3:-serena-samples.jsonl}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
status_file="$(mktemp)"
trap 'rm -f "$status_file"' EXIT
serena_home="${SERENA_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/code-review-toolkit/serena}"

bash "$root/scripts/check-serena-setup.sh" "$revision" "$status_file"
status="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).status)' "$status_file")"
if [[ "$status" != "available" ]]; then
  printf '{"fixture":"setup","status":"%s","compatible":false}\n' "$status" >"$output"
  exit 0
fi

corpus="${SERENA_BENCHMARK_CORPUS:-$root/poc/serena/fixtures/corpus.json}"
command="$(node -e 'process.stdout.write(JSON.stringify([process.argv[1],process.argv[2]]))' "$serena_home/bin/serena-readonly" "$workspace")"
node "$root/poc/serena/benchmark-client.mjs" "$command" "$corpus" "$output" "$serena_home"

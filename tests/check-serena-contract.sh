#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if bash "$root/scripts/setup-serena.sh" abc >"$tmp/out" 2>"$tmp/err"; then
  echo "setup accepted a non-commit revision" >&2
  exit 1
fi
grep -q "exact 40-character" "$tmp/err"

revision="0123456789abcdef0123456789abcdef01234567"
SERENA_HOME="$tmp/home" bash "$root/scripts/setup-serena.sh" "$revision"
grep -Fq "git+https://github.com/oraios/serena.git@$revision" "$tmp/home/bin/serena-readonly"
grep -Fq -- '--enable-web-dashboard false' "$tmp/home/bin/serena-readonly"
grep -Fq -- '--enable-gui-log-window false' "$tmp/home/bin/serena-readonly"
grep -Fq 'exec env -i' "$tmp/home/bin/serena-readonly"
if grep -Eq '(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|GITHUB_TOKEN)' "$tmp/home/bin/serena-readonly"; then
  echo "Serena launcher contains a credential name" >&2
  exit 1
fi
grep -Fq 'node_modules' "$tmp/home/project.yml"
grep -Fq 'vendor' "$tmp/home/project.yml"
grep -Fq 'mocks' "$tmp/home/project.yml"
grep -Fq 'fixed_tools:' "$tmp/home/project.yml"
grep -Fq 'execute_shell_command' "$tmp/home/read-only-context.yml"
grep -Fq 'write_memory' "$tmp/home/read-only-context.yml"
if grep -Eq '^  - (replace_|insert_|write_|execute_|delete_|read_memory|write_memory)' "$tmp/home/project.yml"; then
  echo "generated Serena configuration enables a prohibited tool" >&2
  exit 1
fi

SERENA_HOME="$tmp/home" bash "$root/scripts/check-serena-setup.sh" "$revision" "$tmp/status.json"
node -e '
  const status = JSON.parse(require("fs").readFileSync(process.argv[1]));
  if (status.status !== "available" || status.revision !== process.argv[2]) process.exit(1);
' "$tmp/status.json" "$revision"

SERENA_DISABLED=1 SERENA_HOME="$tmp/disabled" \
  bash "$root/scripts/check-serena-setup.sh" "$revision" "$tmp/disabled.json"
node -e '
  const status = JSON.parse(require("fs").readFileSync(process.argv[1]));
  if (status.status !== "disabled") process.exit(1);
' "$tmp/disabled.json"

SERENA_HOME="$tmp/missing" bash "$root/scripts/check-serena-setup.sh" "$revision" "$tmp/missing.json"
node -e '
  const status = JSON.parse(require("fs").readFileSync(process.argv[1]));
  if (status.status !== "unavailable") process.exit(1);
' "$tmp/missing.json"

if grep -R -Eiq '(GITHUB_TOKEN|GH_TOKEN|API_KEY|SECRET)' "$tmp/home"; then
  echo "generated Serena configuration mentions a secret" >&2
  exit 1
fi

node --test "$root/poc/serena/benchmark-client.test.mjs"

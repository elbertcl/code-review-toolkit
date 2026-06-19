#!/usr/bin/env bash
set -euo pipefail

action_file="opencode-review/action.yml"
context_script="scripts/prepare-review-context.sh"

require_in_file() {
  local file="$1"
  local phrase="$2"

  if ! grep -Fq "${phrase}" "${file}"; then
    printf 'expected %s to contain %q\n' "${file}" "${phrase}" >&2
    exit 1
  fi
}

reject_in_file() {
  local file="$1"
  local phrase="$2"

  if grep -Fq "${phrase}" "${file}"; then
    printf 'expected %s not to contain %q\n' "${file}" "${phrase}" >&2
    exit 1
  fi
}

require_in_file "${action_file}" "anomalyco/opencode/github@v1.17.6"
require_in_file "${action_file}" "default: opencode-go/deepseek-v4-pro"
require_in_file "${action_file}" "inline review comment"
require_in_file "${action_file}" "## PR Verdict"
require_in_file "${action_file}" "### Must Fix Before Merge"
require_in_file "${action_file}" "### Non-Blocking Findings"
require_in_file "${action_file}" "### Progress"
require_in_file "${action_file}" "### Next Action"
require_in_file "${action_file}" "<!-- opencode-pr-review -->"
require_in_file "${action_file}" "<!-- reviewed-head:"
require_in_file "${action_file}" "<!-- findings-json-start"
require_in_file "${action_file}" "findings-json-end -->"
require_in_file "${action_file}" "Do not create an issue comment or PR comment for the summary"
require_in_file "${action_file}" "Verify review comment is posted"
require_in_file "${action_file}" "HEAD_SHA"
require_in_file "${action_file}" "github run"
require_in_file "${action_file}" "[View workflow run]"

require_in_file "${context_script}" ".git/info/exclude"
require_in_file "${context_script}" "AGENTS.md"
require_in_file "${context_script}" "## Changed Files"
reject_in_file "${context_script}" "docs/invariants"
reject_in_file "${context_script}" "docs/architecture"
reject_in_file "${context_script}" "docs/testspecs"

printf 'OpenCode review action contract is satisfied.\n'

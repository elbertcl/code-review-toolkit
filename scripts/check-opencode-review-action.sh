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
require_in_file "${action_file}" "Prepare OpenCode instruction files"
require_in_file "${action_file}" "Ensure review workspace is clean before OpenCode runs"
require_in_file "${action_file}" "Comment-only review mode forbids git writes"
require_in_file "${action_file}" "Output must be PR comments only."
require_in_file "${action_file}" ".opencode/review-pr.opencode.md"
require_in_file "${action_file}" ".opencode/re-review-pr.opencode.md"
require_in_file "${action_file}" 'cp "${{ github.action_path }}/../skills/review-pr/SKILL.md" .opencode/review-pr.base.md'
require_in_file "${action_file}" 'cp "${{ github.action_path }}/../skills/re-review-pr/SKILL.md" .opencode/re-review-pr.base.md'
require_in_file "${action_file}" "inline review comment"
require_in_file "${action_file}" "OpenCode additions:"
require_in_file "${action_file}" "Return the final PR verdict as your final response"
require_in_file "${action_file}" "<!-- opencode-pr-review -->"
require_in_file "${action_file}" "<!-- findings-json-start"
require_in_file "${action_file}" "findings-json-end -->"
require_in_file "${action_file}" "## Repository rules"
require_in_file "${action_file}" "Verify review comment is posted"
require_in_file "${action_file}" "HEAD_SHA"
require_in_file "${action_file}" "github run"
require_in_file "${action_file}" "[View workflow run]"
reject_in_file "${action_file}" 'FIRST: Read the file "${{ github.action_path }}/../skills/review-pr/SKILL.md"'
reject_in_file "${action_file}" 'FIRST: Read the file "${{ github.action_path }}/../skills/re-review-pr/SKILL.md"'

require_in_file "${context_script}" ".git/info/exclude"
require_in_file "${context_script}" ".opencode/"
require_in_file "${context_script}" "AGENTS.md"
require_in_file "${context_script}" "CLAUDE.md"
require_in_file "${context_script}" "## Domain:"
require_in_file "${context_script}" "docs/invariants"
require_in_file "${context_script}" "docs/architecture"
require_in_file "${context_script}" "docs/testspecs"

printf 'OpenCode review action contract is satisfied.\n'

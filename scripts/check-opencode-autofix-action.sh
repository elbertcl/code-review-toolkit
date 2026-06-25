#!/usr/bin/env bash
set -euo pipefail

action_file="opencode-autofix/action.yml"
context_script="scripts/prepare-review-context.sh"

require_in_file() {
  local file="$1" phrase="$2"
  if ! grep -Fq "${phrase}" "${file}"; then
    printf 'expected %s to contain %q\n' "${file}" "${phrase}" >&2
    exit 1
  fi
}

# ── Core wiring ───────────────────────────────────────────────────────────────
require_in_file "${action_file}" "using: composite"
require_in_file "${action_file}" "anomalyco/opencode/github@v1.17.6"
require_in_file "${action_file}" "default: opencode-go/deepseek-v4-pro"
require_in_file "${action_file}" "mentions: /autofix"

# ── Findings ingestion (JSON block + inline) ──────────────────────────────────
require_in_file "${action_file}" "<!-- opencode-pr-review -->"
require_in_file "${action_file}" "findings-json-start"
require_in_file "${action_file}" "findings_scoped.json"

# ── Gap A: capture base + correct finalize (no cosmetic revert) ────────────────
require_in_file "${action_file}" "base_sha"
require_in_file "${action_file}" "force-with-lease"
require_in_file "${action_file}" "restored to"

# ── Gap B: layered context contract reuses the review-context script ──────────
require_in_file "${action_file}" 'prepare-review-context.sh'
require_in_file "${action_file}" "review_context.md"
require_in_file "${action_file}" "context_paths"

# ── Gap C: private cross-repo module token ────────────────────────────────────
require_in_file "${action_file}" "git_token"
require_in_file "${action_file}" "insteadOf"

# ── Gap D: started ack + reaction ─────────────────────────────────────────────
require_in_file "${action_file}" "createForIssueComment"
require_in_file "${action_file}" "OpenCode autofix started"

# ── Gap F: verify_commands is the single source of truth (gate + prompt) ──────
require_in_file "${action_file}" "verify_commands"
require_in_file "${action_file}" "Gap F: single source of truth"

# ── Trust gate + skipped-findings reporting ───────────────────────────────────
require_in_file "${action_file}" "trusted_only"
require_in_file "${action_file}" "autofix_skipped.json"

# ── Context script remains autofix-aware ──────────────────────────────────────
require_in_file "${context_script}" "findings_scoped.json"
require_in_file "${context_script}" "autofix_skipped.json"

printf 'OpenCode autofix action contract is satisfied.\n'

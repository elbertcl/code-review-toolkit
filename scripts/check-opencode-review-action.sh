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

require_in_file "${action_file}" "Run safe headless analysis"
require_in_file "scripts/run-review-analysis.mjs" "provider API key environment is missing or invalid"
require_in_file "scripts/run-review-analysis.mjs" 'edit: "deny"'
require_in_file "scripts/run-review-analysis.mjs" 'bash: "deny"'
require_in_file "scripts/run-review-analysis.mjs" 'webfetch: "deny"'
require_in_file "scripts/run-review-analysis.mjs" 'external_directory: "deny"'
require_in_file "${action_file}" "run-review-analysis.mjs"
require_in_file "${action_file}" "install-opencode.mjs"
require_in_file "${action_file}" "opencode_sha256"
reject_in_file "${action_file}" "anomalyco/opencode/github"
reject_in_file "${action_file}" "gh api"

require_in_file "skills/review-pr/SKILL.md" "Never invoke \`gh\`"
require_in_file "skills/re-review-pr/SKILL.md" "Never invoke \`gh\`"
require_in_file "scripts/run-review-analysis.mjs" "ASTRO_FINDINGS_JSON_START"
require_in_file "scripts/publish-review.mjs" "astro-ai-finding"
require_in_file "scripts/verify-review-publication.mjs" "opencode-pr-review"

require_in_file "${context_script}" "info/exclude"
require_in_file "${context_script}" ".opencode/"
require_in_file "${context_script}" "prepare-review-context.mjs"
require_in_file "scripts/prepare-review-context.mjs" "REVIEW.md"
require_in_file "scripts/prepare-review-context.mjs" "review_context.metadata.json"
require_in_file "scripts/lib/review-manifest.mjs" "backend/security.md"
require_in_file "scripts/lib/review-manifest.mjs" "backend/sre.md"
reject_in_file "${context_script}" "Auto-discovering domains"

printf 'OpenCode review action contract is satisfied.\n'

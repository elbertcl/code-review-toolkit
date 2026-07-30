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

# ── Gap A: sandbox-only — PR's real branch is never touched until verified,
#    so there is no revert/restore push on the failure path ──────────────────
require_in_file "${action_file}" "base_sha"
require_in_file "${action_file}" "force-with-lease"
require_in_file "${action_file}" "PR head untouched"
if grep -Eq 'strategy:|STRATEGY' "${action_file}"; then
  printf 'expected %s to have no rollback/strategy branching left (sandbox-only)\n' "${action_file}" >&2
  exit 1
fi

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

# ── Gap F: verify_commands is the sole gate; self_check_commands is the cheap,
#    untrusted fixer self-check — the full suite must run exactly once ────────
require_in_file "${action_file}" "verify_commands"
require_in_file "${action_file}" "self_check_commands"
require_in_file "${action_file}" "never trusted"

# ── Trust gate + skipped-findings reporting ───────────────────────────────────
require_in_file "${action_file}" "trusted_only"
require_in_file "${action_file}" "autofix_skipped.json"

# ── Security: findings ingestion must be author-filtered to the review bot ────
require_in_file "${action_file}" "github-actions[bot]"

# ── Security: no plain --force fallback on rollback push ──────────────────────
if grep -F -- '--force-with-lease' "${action_file}" | grep -q -- '|| .*git push --force '; then
  printf 'expected %s to NOT fall back to plain --force on lease failure\n' "${action_file}" >&2
  exit 1
fi

# ── Context script remains autofix-aware ──────────────────────────────────────
require_in_file "${context_script}" "findings_scoped.json"
require_in_file "${context_script}" "autofix_skipped.json"

printf 'OpenCode autofix action contract is satisfied.\n'

# ── Reusable workflow (multi-job variant) ──────────────────────────────────────
reusable_workflow=".github/workflows/opencode-autofix.yml"

require_in_file "${reusable_workflow}" "workflow_call"
require_in_file "${reusable_workflow}" "anomalyco/opencode/github@v1.17.6"

# Job graph: fix -> {lint, build, test} -> publish.
for job in "  fix:" "  lint:" "  build:" "  test:" "  publish:"; do
  require_in_file "${reusable_workflow}" "${job}"
done
require_in_file "${reusable_workflow}" "needs: fix"
require_in_file "${reusable_workflow}" "needs: [fix, lint, build, test]"

# Artifact-based handoff between jobs — verify jobs never touch origin
# before the publish job's gate-checked push.
require_in_file "${reusable_workflow}" "upload-artifact"
require_in_file "${reusable_workflow}" "download-artifact"
require_in_file "${reusable_workflow}" "git apply"

# The fix job MUST still stage a local-only sandbox branch before running the
# agent — checking out head_ref directly let an agent-initiated push land on
# the PR's real branch, bypassing the gate entirely (astro-ads-be PR #733,
# commit 1a03222be). Artifact handoff solves cross-JOB data transfer; it does
# NOT solve the agent pushing on its own from inside the fix job — only branch
# isolation does that.
require_in_file "${reusable_workflow}" "stage sandbox branch"
require_in_file "${reusable_workflow}" "checkout -B"

# format_command — mutating-stage equivalent of v1.3.0's lint-gci-new gate
# stage (a separately staged, file-mutating command, run before the
# read-only checks). Dropped by accident in the first multi-job draft.
require_in_file "${reusable_workflow}" "format_command"

# Each verify job needs its own private-module PAT config — split across
# separate runners, none of them share the fix job's pre-warmed module
# cache, so a cold go.sum cache miss needs the same insteadOf rewrite.
require_in_file "${reusable_workflow}" "Configure private module access"

# The toolkit-scripts checkout must stay outside the repo's working tree so
# the agent's own auto-commit (effectively `git add -A`) can't sweep it up as
# a gitlink (observed: commit 1a03222be committed `.toolkit` at mode 160000).
if grep -E "path: \.toolkit\b" "${reusable_workflow}" >/dev/null 2>&1; then
  printf 'expected %s to checkout toolkit scripts outside the repo tree, not into .toolkit\n' "${reusable_workflow}" >&2
  exit 1
fi

# Trust gate + author-filtered findings still apply in the multi-job variant.
require_in_file "${reusable_workflow}" "trusted_only"
require_in_file "${reusable_workflow}" "github-actions[bot]"
require_in_file "${reusable_workflow}" "force-with-lease"

# Publish only proceeds if all three verify jobs succeeded.
require_in_file "${reusable_workflow}" "needs.lint.result"
require_in_file "${reusable_workflow}" "needs.build.result"
require_in_file "${reusable_workflow}" "needs.test.result"

printf 'OpenCode autofix reusable workflow contract is satisfied.\n'

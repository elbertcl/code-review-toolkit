#!/usr/bin/env bash
set -euo pipefail

# Legacy scratch outputs: findings_scoped.json and autofix_skipped.json are
# excluded by prepare-review-context-legacy.sh when the two-argument API runs.

if [ "$#" -eq 2 ]; then
  exec bash "$(dirname "$0")/prepare-review-context-legacy.sh" "$@"
fi

WORKSPACE="${1:-$PWD}"
TRUSTED_REF="${2:?Usage: prepare-review-context.sh <workspace> <trusted-ref> <changed-files-json> <org-contexts> [max-bytes], or <PR_NUMBER> <REPO>}"
CHANGED_FILES="${3:?Usage: prepare-review-context.sh <workspace> <trusted-ref> <changed-files-json> <org-contexts> [max-bytes], or <PR_NUMBER> <REPO>}"
ORG_CONTEXTS="${4:?Usage: prepare-review-context.sh <workspace> <trusted-ref> <changed-files-json> <org-contexts> [max-bytes], or <PR_NUMBER> <REPO>}"
MAX_BYTES="${5:-500000}"

mkdir -p "${WORKSPACE}/.opencode/tmp"
exclude_file="$(git -C "${WORKSPACE}" rev-parse --git-path info/exclude)"
if ! grep -Fxq '.opencode/' "${exclude_file}"; then
  printf '%s\n' '.opencode/' >> "${exclude_file}"
fi

node "$(dirname "$0")/prepare-review-context.mjs" \
  --workspace "${WORKSPACE}" \
  --trusted-ref "${TRUSTED_REF}" \
  --changed-files "${CHANGED_FILES}" \
  --org-contexts "${ORG_CONTEXTS}" \
  --max-bytes "${MAX_BYTES}"

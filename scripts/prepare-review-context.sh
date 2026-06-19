#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="${1:?Usage: prepare-review-context.sh <PR_NUMBER> <REPO>}"
REPO="${2:?Usage: prepare-review-context.sh <PR_NUMBER> <REPO>}"
OUT="review_context.md"
CHANGED_FILES="changed_files.txt"
SCRATCH_FILES=("${OUT}" "findings_scoped.json" "autofix_skipped.json")

exclude_file=".git/info/exclude"
if [ -f "${exclude_file}" ]; then
  for scratch_file in "${SCRATCH_FILES[@]}"; do
    if ! grep -Fxq "${scratch_file}" "${exclude_file}"; then
      printf '%s\n' "${scratch_file}" >> "${exclude_file}"
    fi
  done
fi

if gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate --jq '.[].filename' > "${CHANGED_FILES}"; then
  changed_status="ok"
else
  changed_status="failed"
  : > "${CHANGED_FILES}"
fi

{
  echo "# Review Context"
  echo
  echo "Generated before the OpenCode review runs. Read this file first, then inspect source files as needed."
  echo
  echo "## Repository Rules"
  echo
  if [ -f AGENTS.md ]; then
    echo '```markdown'
    cat AGENTS.md
    echo '```'
  else
    echo "_No AGENTS.md found._"
  fi
  echo
  echo "## Changed Files"
  echo
  if [ "${changed_status}" = "ok" ]; then
    if [ -s "${CHANGED_FILES}" ]; then
      while IFS= read -r file; do
        printf -- '- `%s`\n' "${file}"
      done < "${CHANGED_FILES}"
    else
      echo "_No changed files returned by the GitHub API._"
    fi
  else
    echo "_Unable to fetch changed files with the GitHub API. Review the PR diff directly._"
  fi
  echo
  echo "## Verification Commands"
  echo
  echo "Run these commands when applying autofixes:"
  echo
  echo "1. \`make build\`"
  echo "2. \`make test\`"
  echo "3. \`make lint\`"
  echo
  echo "## Autofix Exclusions"
  echo
  echo "Do not edit:"
  echo
  echo "- \`mocks/\`"
  echo "- \`*_mock.go\`"
} > "${OUT}"

rm -f "${CHANGED_FILES}"

line_count=$(wc -l < "${OUT}" | tr -d ' ')
echo "review_context.md generated with ${line_count} lines"

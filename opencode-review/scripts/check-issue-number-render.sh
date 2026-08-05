#!/usr/bin/env bash
set -euo pipefail
snippet() {
  # $1 = value substituted for ${{ inputs.issue_number }}
  cat <<JS
const issueNumberInput = '${1}';
const issueNumber = (issueNumberInput ? Number(issueNumberInput) : null) || 0;
const mode = issueNumberInput ? 'review' : 'default';
const pocMarker = issueNumberInput ? ' [Serena POC]' : '';
void [issueNumber, mode, pocMarker];
JS
}
for val in "" "123"; do
  snippet "$val" | node --check /dev/stdin && echo "issue_number='$val' -> valid JS"
done
echo "check-issue-number-render: PASS"
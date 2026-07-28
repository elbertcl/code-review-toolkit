#!/usr/bin/env bash
# Complete v3.1.0 compatibility implementation. Keep this path isolated from
# the trusted-manifest compiler used by the hardened reusable workflow.
set -euo pipefail

PR_NUMBER="${1:?Usage: prepare-review-context-legacy.sh <PR_NUMBER> <REPO>}"
REPO="${2:?Usage: prepare-review-context-legacy.sh <PR_NUMBER> <REPO>}"
OUT="review_context.md"

exclude_file=".git/info/exclude"
if [ -f "${exclude_file}" ]; then
  for scratch_file in "${OUT}" findings_scoped.json autofix_skipped.json .opencode/; do
    grep -Fxq "${scratch_file}" "${exclude_file}" || printf '%s\n' "${scratch_file}" >> "${exclude_file}"
  done
fi

find_invariant_file() {
  local domain="$1" best_file="" best_len=0 base len
  if [ -f "docs/invariants/${domain}.md" ]; then printf '%s\n' "docs/invariants/${domain}.md"; return; fi
  for file in docs/invariants/*.md; do
    [ -f "${file}" ] || continue
    base="$(basename "${file}" .md)"
    [[ "${base}" == "cross-domain" || "${base}" == "README" ]] && continue
    case "${domain}" in "${base}"*) len=${#base}; if [ "${len}" -gt "${best_len}" ]; then best_len=${len}; best_file=${file}; fi ;; esac
  done
  if [ -n "${best_file}" ]; then
    printf '%s\n' "${best_file}"
  fi
}

KNOWN_DOMAINS=()
seen=""
for file in docs/invariants/*.md docs/architecture/*.md; do
  [ -f "${file}" ] || continue
  base="$(basename "${file}" .md)"
  [[ "${base}" == "README" || "${base}" == "cross-domain" ]] && continue
  if ! grep -qx "${base}" <<<"${seen}"; then seen+="${base}"$'\n'; KNOWN_DOMAINS+=("${base}"); fi
done
for directory in docs/testspecs/*/; do
  [ -d "${directory}" ] || continue
  base="$(basename "${directory}")"
  if ! grep -qx "${base}" <<<"${seen}"; then seen+="${base}"$'\n'; KNOWN_DOMAINS+=("${base}"); fi
done

CHANGED_FILES="$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate --jq '.[].filename')"
TOUCHED_DOMAINS=()
seen=""
while IFS= read -r changed_file; do
  for domain in "${KNOWN_DOMAINS[@]}"; do
    case "${changed_file}" in *"${domain}"*) if ! grep -qx "${domain}" <<<"${seen}"; then seen+="${domain}"$'\n'; TOUCHED_DOMAINS+=("${domain}"); fi ;; esac
  done
done <<<"${CHANGED_FILES}"

printf '# Review Context (pre-extracted)\n\nGenerated before the review agent ran.\n\n' > "${OUT}"
if [ -f AGENTS.md ]; then
  {
    printf '## AGENTS.md (coding standards)\n\n```markdown\n'
    cat AGENTS.md
    printf '\n```\n\n'
  } >> "${OUT}"
elif [ -f CLAUDE.md ]; then
  {
    printf '## CLAUDE.md (coding standards)\n\n```markdown\n'
    cat CLAUDE.md
    printf '\n```\n\n'
  } >> "${OUT}"
fi
if [ -f docs/invariants/cross-domain.md ]; then printf '## Cross-domain invariants\n\n' >> "${OUT}"; cat docs/invariants/cross-domain.md >> "${OUT}"; fi

for domain in "${TOUCHED_DOMAINS[@]}"; do
  printf '\n## Domain: %s\n\n' "${domain}" >> "${OUT}"
  invariant="$(find_invariant_file "${domain}")"
  if [ -n "${invariant}" ]; then printf "### Invariants (from \`%s\`)\n\n" "${invariant}" >> "${OUT}"; cat "${invariant}" >> "${OUT}"; fi
  architecture="docs/architecture/${domain}.md"
  if [ -f "${architecture}" ]; then printf "\n### Architecture (from \`%s\`)\n\n" "${architecture}" >> "${OUT}"; cat "${architecture}" >> "${OUT}"; fi
  repository="internal/repository/${domain}/repository.go"; [ -f "${repository}" ] || repository="internal/domain/${domain}/db/repository.go"
  if [ -f "${repository}" ]; then { printf "\n### Repository interface (\`%s\`)\n\n\`\`\`go\n" "${repository}"; cat "${repository}"; printf '\n```\n'; } >> "${OUT}"; fi
  printf "\n### Existing function signatures in \`internal/domain/%s/\` (for reuse-check)\n\n\`\`\`\n" "${domain}" >> "${OUT}"
  if [ -d "internal/domain/${domain}" ]; then find "internal/domain/${domain}" -type f -name '*.go' ! -name '*_test.go' ! -name '*.pb.go' -print0 | xargs -0 grep -Hn '^func ' -- >> "${OUT}" || true; fi
  printf '```\n' >> "${OUT}"
  for spec in "docs/testspecs/${domain}"/*.md; do [ -f "${spec}" ] || continue; printf "\n### Testspec \`%s\`\n\n" "${spec}" >> "${OUT}"; cat "${spec}" >> "${OUT}"; done
done
printf '\n## Existing function signatures in `pkg/` (shared utilities, for reuse-check)\n\n```\n' >> "${OUT}"
if [ -d pkg ]; then find pkg -type f -name '*.go' ! -name '*_test.go' ! -name '*.pb.go' -print0 | xargs -0 grep -Hn '^func ' -- >> "${OUT}" || true; fi
printf '```\n' >> "${OUT}"

#!/usr/bin/env bash
# prepare-review-context.sh
#
# Bundles relevant codebase context into review_context.md before the review
# agent runs. Eliminates 10-15 individual file-read turns by pre-loading
# everything the agent needs into a single structured document.
#
# Usage:
#   prepare-review-context.sh <PR_NUMBER> <REPO>
#
# Output:
#   review_context.md in the current directory (workspace root)
#
# Domain discovery — auto-detected from the consuming repo's docs structure:
#   Scans docs/invariants/*.md, docs/architecture/*.md, and docs/testspecs/*/
#   to discover domain names. No hardcoded list — adding a new domain just
#   requires adding its invariant or architecture doc.
#
# Domain detection from PR changed files:
#   For each changed file, match against every discovered domain name using
#   *domainName* wildcards. Path prefix is irrelevant — works for code PRs,
#   docs-only PRs, and mixed PRs.
#
# Invariant file matching — automatic prefix fallback:
#   1. Exact match:  docs/invariants/{domain}.md
#   2. Prefix match: docs/invariants/{prefix}.md where domain starts with prefix
#   3. No match:     invariant section skipped silently
#
# What is included:
#   - AGENTS.md or CLAUDE.md (coding standards) — whichever exists
#   - cross-domain.md invariants — if present
#   - Per-domain: invariants, architecture doc, repository interface,
#     entity files, testspecs
#   - Per-domain: existing function signatures under internal/domain/{domain}/
#     (for reuse-check — lets the review agent spot near-duplicate funcs
#     without grepping the codebase per finding)
#   - Once, repo-wide: existing function signatures under pkg/* (shared
#     utilities — same reuse-check purpose, bounded to pkg/ only)
#
# What is NOT included:
#   - PR diff (already in context from gh pr diff in the workflow)
#   - Test files (*_test.go)
#   - Function bodies for the signature list above — signatures only, to
#     keep review_context.md size bounded

set -euo pipefail

PR_NUMBER="${1:?Usage: prepare-review-context.sh <PR_NUMBER> <REPO>}"
REPO="${2:?Usage: prepare-review-context.sh <PR_NUMBER> <REPO>}"

OUT="review_context.md"
SCRATCH_FILES=("${OUT}" "findings_scoped.json" "autofix_skipped.json" ".opencode/")

# ── Exclude scratch files from git tracking ──────────────────────────────────
exclude_file=".git/info/exclude"
if [ -f "${exclude_file}" ]; then
  for scratch_file in "${SCRATCH_FILES[@]}"; do
    if ! grep -Fxq "${scratch_file}" "${exclude_file}"; then
      printf '%s\n' "${scratch_file}" >> "${exclude_file}"
    fi
  done
fi

# ── Find invariant file for a domain ─────────────────────────────────────────
find_invariant_file() {
  local domain="$1"
  if [ -f "docs/invariants/${domain}.md" ]; then
    echo "docs/invariants/${domain}.md"
    return
  fi
  local best_file="" best_len=0
  for f in docs/invariants/*.md; do
    [ -f "$f" ] || continue
    base=$(basename "$f" .md)
    [ "$base" = "cross-domain" ] && continue
    [ "$base" = "README" ] && continue
    case "$domain" in
      "${base}"*)
        len=${#base}
        if [ "$len" -gt "$best_len" ]; then
          best_len=$len
          best_file=$f
        fi
        ;;
    esac
  done
  [ -n "$best_file" ] && echo "$best_file" || true
}

# ── Auto-discover domain names from this repo's docs structure ───────────────
echo "==> Auto-discovering domains from docs/..."
KNOWN_DOMAINS=()
_seen=""
for f in docs/invariants/*.md docs/architecture/*.md; do
  [ -f "$f" ] || continue
  base=$(basename "$f" .md)
  [[ "$base" == "README" || "$base" == "cross-domain" ]] && continue
  echo "$_seen" | grep -qx "$base" || { _seen+="${base}"$'\n'; KNOWN_DOMAINS+=("$base"); }
done
for d in docs/testspecs/*/; do
  [ -d "$d" ] || continue
  base=$(basename "$d")
  echo "$_seen" | grep -qx "$base" || { _seen+="${base}"$'\n'; KNOWN_DOMAINS+=("$base"); }
done
echo "==> Known domains: ${KNOWN_DOMAINS[*]:-none}"

# ── Fetch changed files from PR ──────────────────────────────────────────────
echo "==> Fetching PR diff file list for PR #${PR_NUMBER}..."
CHANGED_FILES=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" \
  --paginate \
  --jq '.[].filename')

# ── Detect touched domains via wildcard scan ─────────────────────────────────
TOUCHED_DOMAINS=()
_seen2=""
while IFS= read -r f; do
  for domain in "${KNOWN_DOMAINS[@]}"; do
    case "$f" in
      *"${domain}"*)
        echo "$_seen2" | grep -qx "$domain" || { _seen2+="${domain}"$'\n'; TOUCHED_DOMAINS+=("$domain"); }
        ;;
    esac
  done
done <<< "$CHANGED_FILES"

if [ ${#TOUCHED_DOMAINS[@]} -eq 0 ]; then
  echo "==> No known domains touched — writing baseline-only context"
else
  echo "==> Touched by this PR: ${TOUCHED_DOMAINS[*]}"
fi

# ── Start writing review_context.md ──────────────────────────────────────────
cat > "$OUT" <<'HEADER'
# Review Context (pre-extracted)

Generated before the review agent ran.
Read this file instead of reading these files individually.

**Agent instructions:**
- Read this file at the start of your review instead of reading these files individually.
- Use `Read`/`Grep` only for files NOT already covered here.
- Testspecs below are for **Business Correctness (Section 1) only**.
- Function signature lists below (per-domain and `pkg/`) are for **Maintainability reuse-check only** — check new funcs/vars in the diff against these lists before flagging them as genuinely new. Signatures only, no bodies; `Read` the actual file if a candidate match needs closer comparison.

---

HEADER

# ── AGENTS.md or CLAUDE.md (coding standards) ────────────────────────────────
if [ -f "AGENTS.md" ]; then
  echo "## AGENTS.md (coding standards)" >> "$OUT"
  echo "" >> "$OUT"
  echo '```markdown' >> "$OUT"
  cat AGENTS.md >> "$OUT"
  echo '```' >> "$OUT"
  echo "" >> "$OUT"
  echo "---" >> "$OUT"
  echo "" >> "$OUT"
elif [ -f "CLAUDE.md" ]; then
  echo "## CLAUDE.md (coding standards)" >> "$OUT"
  echo "" >> "$OUT"
  echo '```markdown' >> "$OUT"
  cat CLAUDE.md >> "$OUT"
  echo '```' >> "$OUT"
  echo "" >> "$OUT"
  echo "---" >> "$OUT"
  echo "" >> "$OUT"
fi

# ── Cross-domain invariants ──────────────────────────────────────────────────
if [ -f "docs/invariants/cross-domain.md" ]; then
  echo "## Cross-domain invariants" >> "$OUT"
  echo "" >> "$OUT"
  cat "docs/invariants/cross-domain.md" >> "$OUT"
  echo "" >> "$OUT"
  echo "---" >> "$OUT"
  echo "" >> "$OUT"
fi

# ── Per-domain context ───────────────────────────────────────────────────────
for domain in "${TOUCHED_DOMAINS[@]}"; do
  echo "==> Extracting context for domain: ${domain}"

  echo "## Domain: ${domain}" >> "$OUT"
  echo "" >> "$OUT"

  # Invariants
  inv_file="$(find_invariant_file "$domain")"
  if [ -n "$inv_file" ]; then
    echo "### Invariants (from \`${inv_file}\`)" >> "$OUT"
    echo "" >> "$OUT"
    cat "$inv_file" >> "$OUT"
    echo "" >> "$OUT"
  fi

  # Architecture doc
  arch_file="docs/architecture/${domain}.md"
  if [ -f "$arch_file" ]; then
    echo "### Architecture (from \`${arch_file}\`)" >> "$OUT"
    echo "" >> "$OUT"
    cat "$arch_file" >> "$OUT"
    echo "" >> "$OUT"
  fi

  # Repository interface — try flat layered pattern first, then DDD fallback
  repo_file="internal/repository/${domain}/repository.go"
  if [ ! -f "$repo_file" ]; then
    repo_file="internal/domain/${domain}/db/repository.go"
  fi
  if [ -f "$repo_file" ]; then
    echo "### Repository interface (\`${repo_file}\`)" >> "$OUT"
    echo "" >> "$OUT"
    echo '```go' >> "$OUT"
    cat "$repo_file" >> "$OUT"
    echo '```' >> "$OUT"
    echo "" >> "$OUT"
  fi

  # Entity files — try flat shared dir first, then per-domain DDD fallback
  echo "### Touched entity files" >> "$OUT"
  echo "" >> "$OUT"
  entity_count=0

  while IFS= read -r changed_file; do
    # Flat shared entity dir
    if [[ "$changed_file" == "internal/entity/"*"${domain}"* ]] && \
       [[ "$changed_file" != *"_test.go" ]] && [ -f "$changed_file" ]; then
      echo "#### \`${changed_file}\`" >> "$OUT"
      echo '```go' >> "$OUT"; cat "$changed_file" >> "$OUT"; echo '```' >> "$OUT"
      echo "" >> "$OUT"
      entity_count=$((entity_count + 1))
    fi
    # DDD per-domain entity dir
    if [[ "$changed_file" == "internal/domain/${domain}/entity/"* ]] && \
       [[ "$changed_file" != *"_test.go" ]] && [ -f "$changed_file" ]; then
      echo "#### \`${changed_file}\`" >> "$OUT"
      echo '```go' >> "$OUT"; cat "$changed_file" >> "$OUT"; echo '```' >> "$OUT"
      echo "" >> "$OUT"
      entity_count=$((entity_count + 1))
    fi
    [ "$entity_count" -ge 10 ] && {
      echo "_... (capped at 10 entity files — agent should Read remaining files individually)_" >> "$OUT"
      echo "" >> "$OUT"
      break
    }
  done <<< "$CHANGED_FILES"

  if [ "$entity_count" -eq 0 ]; then
    echo "_No entity files changed for this domain._" >> "$OUT"
    echo "" >> "$OUT"
  fi

  # Existing function signatures (for reuse-check) — signatures only, no bodies
  domain_dir="internal/domain/${domain}"
  if [ -d "$domain_dir" ]; then
    echo "### Existing function signatures in \`${domain_dir}/\` (for reuse-check)" >> "$OUT"
    echo "" >> "$OUT"
    echo '```' >> "$OUT"
    find "$domain_dir" -type f -name '*.go' \
      ! -name '*_test.go' ! -name '*.pb.go' ! -name '*_mock.go' ! -name 'mock_*.go' \
      ! -path '*/mocks/*' ! -path '*/mock/*' -print0 \
      | xargs -0 grep -Hn "^func " -- >> "$OUT" || true
    echo '```' >> "$OUT"
    echo "" >> "$OUT"
  fi

  # Testspecs
  testspec_dir="docs/testspecs/${domain}"
  if [ -d "$testspec_dir" ]; then
    echo "### Testspecs (Business Correctness only)" >> "$OUT"
    echo "" >> "$OUT"
    for spec_file in "${testspec_dir}"/*.md; do
      [ -f "$spec_file" ] || continue
      echo "#### \`${spec_file}\`" >> "$OUT"
      echo "" >> "$OUT"
      cat "$spec_file" >> "$OUT"
      echo "" >> "$OUT"
    done
  fi

  echo "---" >> "$OUT"
  echo "" >> "$OUT"
done

# ── Shared pkg/ function signatures (for reuse-check, once — not per-domain) ─
if [ -d "pkg" ]; then
  echo "## Existing function signatures in \`pkg/\` (shared utilities, for reuse-check)" >> "$OUT"
  echo "" >> "$OUT"
  echo '```' >> "$OUT"
  find "pkg" -type f -name '*.go' \
    ! -name '*_test.go' ! -name '*.pb.go' ! -name '*_mock.go' ! -name 'mock_*.go' \
    ! -path '*/mocks/*' ! -path '*/mock/*' -print0 \
    | xargs -0 grep -Hn "^func " -- >> "$OUT" || true
  echo '```' >> "$OUT"
  echo "" >> "$OUT"
  echo "---" >> "$OUT"
  echo "" >> "$OUT"
fi

# ── Size check ──────────────────────────────────────────────────────────────
line_count=$(wc -l < "$OUT")
echo "==> review_context.md generated: ${line_count} lines"
[ "$line_count" -gt 4000 ] && echo "WARNING: review_context.md exceeds 4000 lines (${line_count})."
echo "==> Done. Agents should read review_context.md before reviewing."

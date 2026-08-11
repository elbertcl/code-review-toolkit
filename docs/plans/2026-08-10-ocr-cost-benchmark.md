# OCR Cost Benchmark — astro-ads-be Open PRs

**Goal:** Run `/review-ocr` on all 8 open non-draft PRs in `astronautsid/astro-ads-be`, collect token/cost data, normalize to cost-per-1000-LOC using a 10-file sample, and write results.

**Estimated LLM spend:** ~$0.24 total (8 runs x ~$0.03/run)

**Model:** `deepseek/deepseek-v4-pro`

**Rate table:**

| Component | Rate per 1M tokens |
|-----------|-------------------|
| Input | $0.14 |
| Output | $0.28 |
| Cache read | $0.014 |

---

## Target PRs (open, non-draft)

| PR | Title | +Add | -Del | Files | LOC |
|----|-------|------|------|-------|-----|
| #930 | [SAP-871] partial ack/nack | 246 | 120 | 11 | 366 |
| #929 | wire adindexer cpc refresh | 11 | 3 | 5 | 14 |
| #910 | Datadog monitor audit | 188 | 1 | 2 | 189 |
| #909 | healthcheck wire | 243 | 13 | 7 | 256 |
| #845 | Add Docs Architecture | 346 | 70 | 7 | 416 |
| #828 | SAP-730 observability audit | 416 | 0 | 1 | 416 |
| #756 | scan campaign eligibility | 94 | 0 | 2 | 94 |
| #629 | DLQ architecture docs | 1133 | 17 | 3 | 1150 |

---

## Phases

### Phase 0: Pin workflow to cost-tracking SHA (direct commit)

- **Repo:** `astronautsid/astro-ads-be`
- **File:** `.github/workflows/opencode-pr-ocr.yml`
- **Change:** `elbertcl/code-review-toolkit/opencode-review@v4` -> `@596ff8d`
- **Method:** `gh api` PUT to default branch (direct commit, no PR)
- **Rationale:** `@v4` tag points to `ec6296c` (pre-cost-tracking). `596ff8d` on `origin/main` includes the `**Run:**` footer + telemetry artifact. No `ocr_cost_rates` added (offline computation).

### Phase 1: Snapshot metadata

- Record PR number, title, head SHA, additions, deletions, changedFiles for all 8 PRs
- Fetch per-file LOC breakdown via `gh api .../pulls/<PR>/files`
- Build 10-file sample (largest changed files across all PRs)

### Phase 2: Trigger all 8 reviews

```bash
for pr in 930 929 910 909 845 828 756 629; do
  gh pr comment $pr --repo astronautsid/astro-ads-be --body "/review-ocr"
done
```

### Phase 3: Monitor (~5-10 min, parallel)

Poll `gh run list` until all 8 runs reach `completed`. Handle BLOCKED runs gracefully (manifest validation failures -> no cost data, excluded from averages).

### Phase 4: Collect token data (both sources)

**Primary — verdict footer** (rounded tokens):
```bash
gh api repos/astronautsid/astro-ads-be/issues/<PR>/comments \
  --jq '[.[] | select(.body | test("opencode-pr-review"))] | last | .body'
```
Parse `**Run:**` line -> input, output, cache_read, elapsed.

**Cross-check — telemetry artifacts** (exact tokens):
```bash
gh run download <run-id> --repo astronautsid/astro-ads-be --name review-telemetry-<run-id>
```
Compare against footer; flag any >5% discrepancy.

### Phase 5: Compute cost offline

```
cost = (input x 0.14 + output x 0.28 + cache_read x 0.014) / 1,000,000
```

### Phase 6: Normalize per 1000 LOC

```
cost_per_1000_LOC = (cost_per_run / LOC_changed) x 1000
```

- Per-PR normalization using additions + deletions
- 10-file aggregate sample (largest files across all PRs)

### Phase 7: Write results

Save to `docs/plans/2026-08-10-ocr-cost-benchmark-results.md`:

| Column | Source |
|--------|--------|
| PR # | metadata |
| LOC changed | additions + deletions |
| Input / Output / Cache tokens | telemetry (exact) |
| Elapsed | telemetry |
| Cost ($) | offline computation |
| Cost per 1000 LOC | normalization |
| Verdict | PASS / FAIL / BLOCKED |

Plus: 10-file sample table, aggregate stats (mean/median/min/max), BLOCKED run notes.

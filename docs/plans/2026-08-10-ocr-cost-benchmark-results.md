# OCR Cost Benchmark Results — astro-ads-be Open PRs

**Date:** 2026-08-10
**Method:** Local OCR CLI (`@alibaba-group/open-code-review@1.8.9`) against cloned PR diffs
**Model:** `deepseek/deepseek-v4-pro` via `ai-gateway.astronauts.id`
**Rate table:** input $0.14/M, output $0.28/M, cache_read $0.014/M

---

## Summary

| Metric | Value |
|--------|-------|
| PRs tested | 8 (all open non-draft) |
| PRs with reviewable code | 5 |
| Docs-only PRs (0 tokens) | 3 |
| Total LLM cost | **$0.15090** |
| **Cost per 1000 LOC (10-file sample)** | **$0.2020** |
| Cost per 1000 LOC (all code PRs, 919 LOC) | $0.1642 |
| Cost per 1000 LOC (weighted avg, 3 source PRs) | $0.2070 |

---

## Per-PR Results

| PR | Title | LOC | Files Reviewed | Input Tok | Output Tok | Cache Tok | Total Tok | Cost $ | Elapsed | Cost/1K LOC |
|----|-------|-----|----------------|-----------|------------|-----------|-----------|--------|---------|-------------|
| #930 | [SAP-871] partial ack/nack | 366 | 5/11 | 461,048 | 50,564 | 374,220 | 511,612 | $0.08394 | 10m02s | $0.2294 |
| #929 | wire adindexer cpc refresh | 14 | 2/5 | 11,317 | 1,514 | 8,860 | 12,831 | $0.00213 | 28s | $0.1523 |
| #910 | Datadog monitor audit (docs) | 189 | 1/2 | 2,876 | 418 | 2,050 | 3,294 | $0.00055 | 16s | $0.0029 |
| #909 | healthcheck wire [SAP-859] | 256 | 4/7 | 343,659 | 32,566 | 293,039 | 376,225 | $0.06133 | 7m33s | $0.2396 |
| #845 | Add Docs Architecture (docs) | 416 | 0/7 | 0 | 0 | 0 | 0 | $0.00000 | 3s | — |
| #828 | SAP-730 observability audit (docs) | 416 | 0/1 | 0 | 0 | 0 | 0 | $0.00000 | 1s | — |
| #756 | scan campaign eligibility | 94 | 1/2 | 17,081 | 1,383 | 11,381 | 18,464 | $0.00294 | 1m08s | $0.0313 |
| #629 | DLQ architecture docs (docs) | 1150 | 0/3 | 0 | 0 | 0 | 0 | $0.00000 | 2s | — |

**Cost formula:** `(input_tokens x 0.14 + output_tokens x 0.28 + cache_read_tokens x 0.014) / 1,000,000`

**Key observations:**
- PRs #845, #828, #629 are docs-only (.md files) — OCR excludes them, zero cost
- PR #930 is the most expensive ($0.084) due to 5 reviewed Go files with deep context
- PR #909 is second ($0.061) — health check wiring across 4 source files
- PR #756 has low cost-per-LOC ($0.031) because only 3 lines of non-test code changed
- Token usage is dominated by input tokens (full file context reads), not output

---

## 10-File Sample Benchmark

The 10 largest code files by changed LOC across all 8 PRs:

| # | File | PR | +Add | -Del | LOC |
|---|------|----|------|------|-----|
| 1 | `pkg/infrastructure/health/health_test.go` | #909 | +115 | -0 | 115 |
| 2 | `internal/integration/admanager/entity/scan_campaigns_test.go` | #756 | +92 | -0 | 92 |
| 3 | `internal/domain/tracker/service/ingest_dedup_test.go` | #930 | +55 | -31 | 86 |
| 4 | `internal/domain/tracker/service/ingest_dedup.go` | #930 | +58 | -22 | 80 |
| 5 | `mocks/domain/tracker/service/mock_ingest_dedup.go` | #930 | +30 | -20 | 50 |
| 6 | `mocks/domain/tracker/service/mock_journey_validator.go` | #930 | +37 | -4 | 41 |
| 7 | `internal/domain/tracker/service/journey_validator_test.go` | #930 | +21 | -17 | 38 |
| 8 | `pkg/infrastructure/health/health.go` | #909 | +34 | -1 | 35 |
| 9 | `internal/domain/tracker/service/journey_validator.go` | #930 | +24 | -11 | 35 |
| 10 | `pkg/infrastructure/health/redis.go` | #909 | +28 | -0 | 28 |
| | **Total** | | | | **600** |

### Cost Calculation

These 10 files span 3 PRs (#930, #909, #756) with a combined 716 LOC and $0.14821 total cost.

| Metric | Value |
|--------|-------|
| 10-file total LOC | 600 |
| Source PR total LOC | 716 |
| Source PR total cost | $0.14821 |
| Proportional 10-file cost | $0.12121 |
| **Cost per 1000 LOC (10-file sample)** | **$0.2020** |

---

## Cost Normalization

| Basis | LOC | Cost | Cost / 1K LOC |
|-------|-----|------|---------------|
| 10-file sample (proportional) | 600 | $0.12121 | **$0.2020** |
| 3 source PRs (weighted average) | 716 | $0.14821 | $0.2070 |
| All 5 code PRs | 919 | $0.15090 | $0.1642 |
| All 8 PRs (including docs) | 2901 | $0.15090 | $0.0520 |

**Recommended planning figure: $0.20 per 1000 LOC** for code-bearing PRs.

---

## Methodology

### What was done
1. Cloned `astronautsid/astro-ads-be` (full history, blobless filter)
2. Fetched all 8 open non-draft PR branches via `git fetch origin pull/<N>/head`
3. For each PR, computed merge-base against `develop` and ran:
   ```
   ocr review --from <base_sha> --to pr-<N> --format json --audience agent
   ```
4. Captured `/tmp/findings-<N>.json` with token summary, elapsed, and findings
5. Computed dollar cost offline using the deepseek-v4-pro rate table

### What was NOT done
- No modifications to `astro-ads-be` (no PRs, no workflow changes, no comments posted)
- No OCR rules (`--rule`) or Serena background context (`--background-file`) — ran with OCR defaults only
- This means token counts are slightly lower than production CI runs (which compile rules from REVIEW.md + org profiles)

### Caveats
- **Token counts are conservative**: production CI runs include compiled rule.json (~2-5K tokens) and Serena background file (~2KB) which add to input tokens. Expect +5-10% in CI.
- **Cost-per-LOC is non-linear**: OCR reads full file content for context, not just diff lines. A 3-line change in a 500-line file costs nearly as much as a 100-line change in the same file.
- **Docs-only PRs are free**: OCR excludes `.md`, `.yaml`, `.json` files by default. 3 of 8 PRs had zero cost.
- **Test files excluded by default**: OCR's `default_path` exclusion skips `*_test.go` files. The "Files Reviewed" column shows reviewed/total.

---

## Raw Data

Findings JSON files: `/tmp/findings-{929,930,910,909,845,828,756,629}.json`
OCR stderr logs: `/tmp/ocr-stderr-{929,930,910,909,845,828,756,629}.log`

### Token breakdown per PR

```json
{
  "930": { "input": 461048, "output": 50564, "cache_read": 374220, "elapsed_ms": 601561 },
  "929": { "input": 11317,  "output": 1514,  "cache_read": 8860,   "elapsed_ms": 27633 },
  "910": { "input": 2876,   "output": 418,   "cache_read": 2050,   "elapsed_ms": 16061 },
  "909": { "input": 343659, "output": 32566, "cache_read": 293039, "elapsed_ms": 452691 },
  "845": { "input": 0,      "output": 0,     "cache_read": 0,      "elapsed_ms": 2632 },
  "828": { "input": 0,      "output": 0,     "cache_read": 0,      "elapsed_ms": 1139 },
  "756": { "input": 17081,  "output": 1383,  "cache_read": 11381,  "elapsed_ms": 68414 },
  "629": { "input": 0,      "output": 0,     "cache_read": 0,      "elapsed_ms": 2434 }
}
```

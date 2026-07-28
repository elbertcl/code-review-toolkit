# Metrics POC

## Operating mode

The metrics implementation is **POC_ONLY**. The approved sink, owner, access controls,
retention period, and deletion process remain pending. Therefore the checked-in workflow
is manual (`workflow_dispatch`) and renders only checked-in sanitized fixture metadata.
It has no production schedule, GitHub API collection, Pages deployment, or external
export.

## Outcome contract

Finding identity comes only from a `github-actions[bot]` publication marker containing
`run_id`, `run_url`, `workflow_path`, and the canonical immutable `toolkit_sha`. An
injected trusted Actions-run resolver must return that exact run ID, URL, and workflow
path with a `success` conclusion; missing, unmatched, unsuccessful, and malformed
provenance is ignored. The `github-actions[bot]` login is shared by workflows in a
repository, so author identity alone is not provenance; repository administrators can
still replace trusted workflow code or authorize another workflow with write access.
`astro-ai-finding` marker matched to the first comment in its review thread. A resolved
thread is `accepted` unless a later valid outcome marker states otherwise. Explicit
markers use this contract:

```html
<!-- astro-ai-outcome:{"schema_version":1,"finding_id":"arf_...","outcome":"disputed"} -->
```

Allowed outcomes are `accepted`, `disputed`, `deferred`, and `unclassified`. The latest
valid marker for the same finding wins. Malformed, unknown, and mismatched markers are
ignored. Open threads without an explicit marker are `unclassified`. This is the POC
classification rule, not approval to mutate review threads or create a parallel outcome
store.

## Approved metadata

The collector may retain only:

| Field | Purpose |
|---|---|
| `repository`, `pr_number` | Aggregate scope and audit reference |
| `finding_id`, `thread_id` | Idempotence and thread-backed audit reference |
| `dimension`, `severity`, `outcome` | Metric dimensions |
| `finding_created_at`, `pr_merged_at` | Timing and cohort analysis |
| `toolkit_sha`, `provider`, `model`, `confidence` | Immutable toolkit provenance and POC comparison dimensions |
| `review_latency_ms`, `review_cost_usd` | Review runtime and provider cost |
| `matched_qualifying_human`, `unmatched_qualifying_human_count` | Recall estimate inputs derived from qualifying human inline findings |

It must never persist PR body, diff, source code, file path, diff hunk, or full issue or
review comment text. Collection deduplicates on repository, PR number, and finding ID.
REST readers follow pagination, including sets larger than 100 records.

## Outputs and formulas

`render-metrics-dashboard.mjs` writes `index.html`, `summary.json`, and
`audit-sample.json`. The audit sample contains only the approved metadata above.

- Observed precision = accepted / (accepted + disputed).
- Estimated recall = matched accepted AI findings / (matched accepted AI findings + unmatched qualifying human inline findings).
- Classification rate = non-unclassified findings / all findings.
- Dashboard breakdowns group by repository, severity, and model and report p50/p95 latency and cost plus rejection, failure, and confidence counts.
- Any formula with a zero denominator is JSON `null` and displays as `N/A`, never zero.

Run the local POC with:

```bash
node scripts/collect-metrics.mjs tests/fixtures/metrics/github-input.json 2026-07 > metrics.json
node scripts/render-metrics-dashboard.mjs metrics.json metrics-dashboard
```

The `metrics-dashboard` directory is a disposable local artifact and must not be treated
as a production sink.

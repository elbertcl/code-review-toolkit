# Design: Review-Comments Resolution — Trigger Defaults, Per-Repo Models, Dimensions Fallback, Benchmarking & Observability

**Date:** 2026-08-21
**Status:** Approved (two review sessions)
**Scope:** All five review comments, one implementation plan

---

## 1. Background

Five comments were raised against the toolkit:

1. *gmn cara kita: default trigger always-on-push, custom trigger per repo* — flip the manual `/review` default
2. *confirm review-dimension if not given by repo, then what will we apply?* — what happens when a repo has no `docs/review-dimensions.md`
3. *can each repo customize their own model choice?* — per-repo OCR model
4. *kalo ada validation error dari REVIEW.md rule, error message nya muncul jadi PR comment gak?* — validation-error surfacing (already works; polish)
5. *benchmarking model technicality nya nanti gmn?* — model benchmarking, deep-dived into a full observability framework

## 2. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Trigger default | Reusable workflow; **always-on-push becomes the out-of-box default**, manual-only remains a documented slim alternative |
| D2 | Benchmark scope | Cost **and** quality |
| D3 | Plan scope | All 5 items in one implementation plan |
| D4 | Metrics transport | **Direct push at t0** from each review run + **outcome workflow at t2**; Datadog primary, metric names OTel-GenAI-aligned for future OSS port |
| D5 | Quality ground truth | PR-closed workflow (thread outcomes are final only at close) |
| D6 | Benchmark evaluators | Deterministic only in v1 (no LLM-as-judge) |
| D7 | Existing `review-monitoring.yml` | **Delete** — superseded; discovered non-functional (see §7) |

## 3. Item 1 — Trigger default: always-on-push via reusable workflow

**New file:** `.github/workflows/pr-review.yml` in the toolkit repo (`on: workflow_call`), wrapping `elbertcl/code-review-toolkit/opencode-review@v4`. Inputs mirror the composite action (`org_profiles`, `ocr_model`, `ocr_cost_rates`, `fail_closed_context`, `ocr_llm_url`/`ocr_llm_token` under `secrets:`, `metrics_datadog_api_key` under `secrets:`).

Checkout in the reusable job must handle both event types:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || format('refs/pull/{0}/head', github.event.issue.number) }}
```

**Consumer default** (README rewrite of Setup):

```yaml
on:
  pull_request:
    types: [opened, synchronize]
  issue_comment:
    types: [created]
concurrency:
  group: review-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
jobs:
  review:
    if: |
      (github.event_name == 'issue_comment' && github.event.issue.pull_request != null &&
       github.event.comment.body == '/review') ||
      (github.event_name == 'pull_request')
    uses: elbertcl/code-review-toolkit/.github/workflows/pr-review.yml@v4
    secrets: ...
```

Manual-only repos copy the slim `issue_comment` workflow (documented alternative).

Already-supported machinery reused as-is: event-agnostic PR-number resolution (action.yml `pr-info`), draft-PR skip, loop guard (same-HEAD dedup), re-review mode detection. README §"Auto-Review on Push" flips from "non-goal, opt-in" to the default; spend control via concurrency cancel + loop guard.

## 4. Item 2 — Org-default dimensions when repo omits them

**Gap:** missing `REVIEW.md` falls back to the bundled manifest, but `policy_path` still points to repo-relative `docs/review-dimensions.md`; if absent, `policyBody = ''` → `policyDimensions = ''`. The org-default dimensions embedded in the bundled `REVIEW.md` (`# Review Dimensions` section) are never used.

**Fix:**
- `resolve-manifest.ts`: when in fallback mode **and** the workspace `manifest.policy_path` file does not exist, extract the `# Review Dimensions` body from the bundled fallback `REVIEW.md` and emit it as `defaultPolicyBody` in the status output JSON. When the repo's own policy exists, `defaultPolicyBody` is empty (repo wins).
- action.yml compile step: `policyBody = existsSync(manifest.policy_path) ? read(...) : status.defaultPolicyBody`.
- Dimensions applied by default: Business Correctness (RULE-XXX-NN enforcement), Performance (N+1 DB calls), Maintainability (repo conventions).
- Unit test: fallback + missing policy → `defaultPolicyBody` populated; repo policy present → empty.

## 5. Items 3 & 4 — Per-repo model; comment polish

**`ocr_model` input** (default `deepseek/deepseek-v4-pro`):
- Replaces the hardcoded `ocr config set llm.model` (action.yml:636) and the hardcoded `model` field in the telemetry row (action.yml:835).
- `ocr_cost_rates` already keys rates by model ID — per-repo cost tracking keeps working unchanged.
- README: document with the models.dev verification caveat.

**BLOCKED double-comment dedupe:**
- The compile-rules step sets step output `aborted_with_comment=true` immediately before its `exit 1` on BLOCKED.
- The generic "Post failure comment" step (action.yml:863) gains `&& steps.ocr-rules.outputs.aborted_with_comment != 'true'` so BLOCKED runs show only the specific abort message.

## 6. Item 5 — Benchmarking & observability framework

### 6.1 Measurement dimensions

| Dim | What | When | Source |
|-----|------|------|--------|
| **D1 Efficiency** | tokens in/out/cache, cost, cost-per-1K-LOC, elapsed, tool calls | t0 review completion | telemetry row (add repo/model tags) |
| **D2 Effectiveness** | precision_observed, recall_estimated, severity_calibration, suppression_accuracy | t2 PR close | thread outcomes + `precision-recall.ts` |
| **D3 Engagement** | thread_resolve_rate, fix_rate, time_to_first_response_h | t2 PR close | GitHub API |
| **D4 Context** | rules_compiled, conditional_contexts_matched, directives_applied, rule/background bytes, serena pointer size, rule_citation_rate | t0 | `resolve-manifest` + `compile-ocr-rules` |
| **D5 Reliability** | blocked rate, fallback rate, serena fail-open rate, run failures | t0 | manifest-status |

Every metric is a gauge `code_review_toolkit.<dim>.<metric>` with mandatory tags `repo`, `model`, `org_profile`, `mode`, `verdict`. Token/cost field names mirror OTel GenAI semconv so a Prometheus/Langfuse port is a rename, not a redesign.

**Answers the driving questions:** per-repo model performance = D1+D2+D5 sliced by `repo:model` tags; contexts used per repo = D4 block emitted per run.

### 6.2 Telemetry v2 (per-run row)

Add to the existing `review-run.json`: `repo`, `model` (from `ocr_model`), `org_profiles`, and a `context` block: `{rules_compiled, conditional_contexts_matched[], directives_applied[], rule_json_bytes, background_bytes, serena_pointer_chars, manifest_status, fallback_reason}`. Verdict footer gains a `model:<id>` line — the t2 join key.

### 6.3 t0 emission — direct push

- New `src/monitoring/push-run-metrics.ts` **with a real CLI entry** (unlike the current no-op monitoring scripts): reads telemetry v2 row, pushes D1/D4/D5 gauges to Datadog API v2.
- New action inputs: `metrics_datadog_api_key`, `metrics_datadog_site` (default `datadoghq.com`). Empty key → skip silently (opt-out repos unaffected).
- Telemetry artifact retained as raw record.

### 6.4 t2 emission — PR-closed outcome workflow

- New reusable workflow `.github/workflows/review-outcome.yml` (`workflow_call`); consuming repos add a slim `on: pull_request: [closed]` trigger.
- Checks out the toolkit repo at the called ref, runs `dist/monitoring/classify-outcomes.js` with `GH_TOKEN`.
- **Classifier** reconstructs runs from the PR itself: verdict comments (marker + `model:` line) recover t0 tags; bot inline `[SEVERITY]` comments are the findings; review threads supply outcomes:
  - `accepted` — thread resolved
  - `disputed` — human reply before resolution (non-bot reply present)
  - `unaddressed` — unresolved at close
  - Human review threads without a nearby bot finding (anchor match, ±5 lines) → `unmatchedHumanFindings`
- Feeds the existing `precision-recall.ts` (`computeObservedPrecision`, `computeEstimatedRecall`) — finally wiring it — and pushes D2/D3 with the recovered t0 tags plus `outcome_lag_h`.
- v1 simplification (recorded): no diff-based accepted-vs-acknowledged split; recall is *estimated* (human findings may overlap bot findings legitimately).

### 6.5 Offline benchmark harness — `scripts/benchmark/`

- **Corpus** `corpus/manifest.json`: entries `{repo, pr, base_sha, head_sha, expected_findings: [{path, line_approx, severity, rule_id?}]}`. Sources: auto-mined from closed PRs via the t2 classifier (one implementation, two uses) + curated golden set seeded by the 4 capability-test PRs (`docs/plans/2026-08-13-toolkit-capability-test-plan.md`).
- **Runner** `run-matrix.ts`: model × corpus × N repetitions (default 3) via local OCR CLI (`ocr config set llm.model`), capturing findings/anchors/tokens/elapsed per run — the proven 2026-08-10 methodology.
- **Evaluators (deterministic, v1):** anchor-window match (±5 lines) → precision/recall; severity exact-match rate; rule-citation rate (`RULE-XXX-NN` regex in finding text); cost-per-1K-LOC.
- **Output:** `docs/plans/<date>-model-benchmark-results.md` scorecard; optionally push `code_review_toolkit.benchmark.*` tagged by `model` so model-vs-model queries live in the same dashboard.

### 6.6 Dashboard

Single Datadog dashboard `code-review-toolkit`: sections D1–D5, template variables `repo`/`model`/`org_profile`. Monitors: D5 BLOCKED-rate per repo; D2 precision drop below threshold over a rolling window. Dashboard JSON committed at `docs/dashboard/datadog-code-review-toolkit.json` (import-based in v1; Terraform out of scope).

## 7. Discovered defects justifying monitoring replacement (D7)

1. `workflow_run` in `review-monitoring.yml` only fires for same-repo workflows — it can never trigger on consuming-repo review runs.
2. `download-artifact` uses exact name `review-telemetry-` while uploads are `review-telemetry-<run_id>` → silent no-op via `continue-on-error`.
3. `collect-telemetry.js` / `push-datadog.js` have no `process.argv` CLI entry in dist — the workflow's node commands cannot work.

`precision-recall.ts` exists but was never wired to any producer.

## 8. Error handling

- Datadog push failures at t0/t2: log a workflow warning, **never fail the review** (metrics are best-effort).
- Outcome classifier: PRs with zero bot findings → push nothing (no divide-by-zero metrics).
- Benchmark harness: per-cell failures recorded in the scorecard as `ERROR`, matrix continues.
- `ocr_model` invalid: fails fast at `ocr` CLI config/run with the existing failure-comment path.

## 9. Testing strategy

- `resolve-manifest.test.ts`: defaultPolicyBody cases (fallback+missing policy / repo policy present / fallback with repo policy present).
- `classify-outcomes.test.ts`: thread fixtures covering accepted / disputed / unaddressed / unmatched-human.
- `push-run-metrics.test.ts`: series construction (names, tags), empty-key skip.
- `collect-telemetry` / `precision-recall`: extend for v2 fields.
- Benchmark evaluators: unit tests with synthetic finding sets.
- CI gate unchanged: `npm run typecheck && npm test && npm run build && npm run check-dist` (dist committed with src).

## 10. Non-goals (v1)

- LLM-as-judge evaluators; diff-based accepted/acknowledged split; OSS (Prometheus/Langfuse) emission path; Terraform-managed dashboard; cross-repo central scraper.

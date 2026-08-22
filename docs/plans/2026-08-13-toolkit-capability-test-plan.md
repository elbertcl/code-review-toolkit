# Toolkit Capability Validation — Test Plan

**Goal:** Validate 4 core toolkit capabilities via controlled dummy PRs in
`astronautsid/astro-ads-be`, each designed to exercise one capability end-to-end
through the `/review-ocr` trigger.

**Review trigger:** `/review-ocr` (workflow: `opencode-pr-ocr.yml`, action:
`elbertcl/code-review-toolkit/opencode-review@v4`)

**Base branch:** `develop`

**Repo structure context:**
- Go backend, DDD layout (`internal/domain/{tracker,admanager,...}`)
- `REVIEW.md` manifest with schema v2, backend profile
- `docs/invariants/*.md` loaded as `conditional_context` when matching domain files change
- Existing conventions: `docs/conventions/{golang,database,structure,...}.md`

---

## Test Cases at a Glance

| # | Test Case | Branch | What It Validates | Multi-step? |
|---|-----------|--------|-------------------|-------------|
| 1 | Serena MCP | `test/toolkit-serena-mcp` | Symbol-reference enrichment reaches OCR background file | No |
| 2 | Prior Learnings | `test/toolkit-prior-learnings` | Resolved-thread reasoning is injected + suppresses re-flagging | **Yes** (review → resolve → re-review) |
| 3 | Monitoring / Telemetry | `test/toolkit-monitoring` | Per-run telemetry artifact completeness + verdict footer | No |
| 4 | Business Invariant Violation | `test/toolkit-invariant-violation` | Reviewer catches code that compiles/lints but violates a `[CRITICAL]` invariant | No |

---

## PR 1 — Serena MCP Context Fetcher

### Objective

Verify that Serena's `get_symbols_overview` + `find_referencing_symbols`
produce non-empty symbol-reference output that reaches the OCR
`--background-file`, and that `serena.status` in telemetry is `available`.

### Branch

```
test/toolkit-serena-mcp
```

### Files to create

**`internal/domain/tracker/service/ingest_summary.go`** (new file)

This file deliberately references symbols defined in other files within the
same package (`IngestResult`, `IngestDeduplicator`, `entity.Event`,
`PublishEventsResult`) so Serena can resolve cross-file references.

```go
package service

import (
	"context"
	"fmt"

	"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity"
)

// IngestSummary is a debug utility that summarizes an IngestResult.
// Introduced for test/toolkit-serena-mcp — exercises Serena cross-file reference resolution.
type IngestSummary struct {
	Acked   int
	Retried int
}

func SummarizeIngestResult(result IngestResult) IngestSummary {
	return IngestSummary{
		Acked:   len(result.AckEvents),
		Retried: len(result.RetryEvents),
	}
}

func ClassifyEvent(event entity.Event) string {
	if event.Detail.IsBillable {
		return fmt.Sprintf("billable:%s", event.Detail.Type)
	}
	return fmt.Sprintf("non-billable:%s", event.Detail.Type)
}

func SummarizePublishResult(result PublishEventsResult) IngestSummary {
	return IngestSummary{
		Acked:   len(result.Success),
		Retried: len(result.Failed),
	}
}

func ProcessAndSummarize(ctx context.Context, dedup IngestDeduplicator, events []entity.Event) (IngestSummary, error) {
	toProcess, toRepublish, err := dedup.PartitionByIngestState(ctx, events)
	if err != nil {
		return IngestSummary{}, fmt.Errorf("partition: %w", err)
	}
	total := len(toProcess) + len(toRepublish)
	return IngestSummary{Acked: total}, nil
}
```

**`internal/domain/tracker/service/ingest_summary_test.go`** (new file — minimal test so the PR is realistic)

```go
package service

import (
	"testing"

	"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity"
	"github.com/google/uuid"
)

func TestSummarizeIngestResult(t *testing.T) {
	result := IngestResult{
		AckEvents:   []entity.Event{{}},
		RetryEvents: []entity.Event{{}, {}},
	}
	summary := SummarizeIngestResult(result)
	if summary.Acked != 1 || summary.Retried != 2 {
		t.Fatalf("expected acked=1 retried=2, got %+v", summary)
	}
}

func TestClassifyEvent(t *testing.T) {
	event := entity.Event{}
	event.Detail.Type = entity.EventTypeClicked
	event.Detail.IsBillable = true
	got := ClassifyEvent(event)
	if got != "billable:CLICKED" {
		t.Fatalf("expected billable:CLICKED, got %s", got)
	}
}

func TestSummarizePublishResult(t *testing.T) {
	result := PublishEventsResult{
		Success: []entity.Event{{}},
		Failed:  []FailedPublish{{}},
	}
	summary := SummarizePublishResult(result)
	if summary.Acked != 1 || summary.Retried != 1 {
		t.Fatalf("expected acked=1 retried=1, got %+v", summary)
	}
}

// ensure uuid import is used (realistic for event fixtures)
var _ = uuid.New
```

### Why this exercises Serena

The new file references 4 cross-file symbols:
- `IngestResult` (defined in `service.go` via type alias)
- `IngestDeduplicator` (interface in `ingest_dedup.go`)
- `PublishEventsResult` (struct in `service.go`)
- `entity.Event` (external package)

Serena's `find_referencing_symbols` should resolve all of these, producing
`path:line` references in the pointer artifact.

### Steps

1. Create branch `test/toolkit-serena-mcp` off `develop`
2. Add the two files above
3. Open PR titled: `[TEST] toolkit: Serena MCP context fetcher validation`
4. Comment `/review-ocr` on the PR
5. Wait for the review to complete (~2-5 min)

### Verification checklist

| # | Check | How to verify | Pass criteria |
|---|-------|---------------|---------------|
| 1 | Serena status in telemetry | Download `review-telemetry-<run_id>` artifact, check `serena` field | `serena.status == "available"` |
| 2 | Background file contains symbols | Check workflow logs or telemetry for Serena context output | Contains function/type names from `ingest_summary.go` |
| 3 | Background file contains references | Same artifact | Contains `referenced by:` lines with `path:line` format |
| 4 | Review completes without error | Check workflow run status | Green / completed |
| 5 | OCR findings reference cross-file context | Check inline comments for any findings | Findings show awareness of the broader package context (not just the diff) |

### Fail-open regression (optional bonus)

After the main test passes, set an invalid Serena SHA in a second run to verify
fail-open:

```yaml
# Temporarily add to opencode-pr-ocr.yml inputs:
serena_sha: "0000000000000000000000000000000000000000"
```

Verify: review still completes, `serena.status == "unavailable"`, no crash.

---

## PR 2 — Prior Learnings Injection (Multi-step)

### Objective

Verify the full resolved-thread injection chain:
1. First review flags a known issue
2. Thread is resolved with human reasoning
3. Re-review suppresses the resolved finding and injects the reasoning

### Branch

```
test/toolkit-prior-learnings
```

### Step 1: Initial commit with a known issue

**`internal/domain/tracker/service/event_lookup.go`** (new file)

```go
package service

import (
	"context"

	"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity"
)

// EventLookup retrieves events by impression ID from the repository.
// This is a simplified lookup for testing purposes.
type EventLookup struct {
	repo EventLookupRepo
}

type EventLookupRepo interface {
	FindByImpressionID(ctx context.Context, impressionID string) ([]entity.Event, error)
}

func NewEventLookup(repo EventLookupRepo) EventLookup {
	return EventLookup{repo: repo}
}

// FindByImpression returns events for a given impression ID.
// BUG: swallows the repository error silently — should propagate it.
func (l EventLookup) FindByImpression(ctx context.Context, impressionID string) ([]entity.Event, error) {
	events, err := l.repo.FindByImpressionID(ctx, impressionID)
	if err != nil {
		return []entity.Event{}, nil
	}
	return events, nil
}
```

**Known issue:** `FindByImpression` swallows the repository error
(`err != nil` → returns `nil` error with empty slice). The reviewer should
flag this as an error-handling issue.

### Step 2: First review

1. Open PR titled: `[TEST] toolkit: prior learnings injection validation`
2. Comment `/review-ocr`
3. Wait for review to complete
4. **Verify:** at least one inline comment flags the swallowed error in
   `FindByImpression`

### Step 3: Resolve the thread with reasoning

1. Reply to the finding's inline comment thread:
   ```
   Fixed — the error is now propagated to the caller so upstream retry logic
   can handle it. Returning a nil error on repository failure would mask
   transient errors and prevent Pub/Sub redelivery from retrying.
   ```
2. Push a commit that fixes the issue:
   ```go
   func (l EventLookup) FindByImpression(ctx context.Context, impressionID string) ([]entity.Event, error) {
       events, err := l.repo.FindByImpressionID(ctx, impressionID)
       if err != nil {
           return nil, fmt.Errorf("find by impression: %w", err)
       }
       return events, nil
   }
   ```
3. Click **"Resolve conversation"** on the thread

### Step 4: Re-review

1. Push another commit (can be a trivial whitespace or comment change to
   trigger a new diff)
2. Comment `/review-ocr` again
3. Wait for the re-review to complete

### Verification checklist

| # | Check | How to verify | Pass criteria |
|---|-------|---------------|---------------|
| 1 | First review flags the issue | Check inline comments after step 2 | ≥ 1 finding about swallowed error |
| 2 | Resolved finding is NOT re-posted | Check inline comments after step 4 | The error-swallowing finding does not appear again |
| 3 | `suppressed_as_duplicate` ≥ 1 | Check verdict comment footer or telemetry artifact | Count ≥ 1 |
| 4 | Verdict mentions prior suppression | Check verdict comment body | Contains "previously flagged" or "suppressed as duplicate" |
| 5 | Background digest contains reasoning | Download telemetry artifact, inspect background file | Contains "Fixed — the error is now propagated" text |
| 6 | Background excludes unresolved threads | Same artifact | No text from unresolved threads appears |
| 7 | Re-review only covers new diff | Check which files/lines were reviewed | Only the new commit's diff is reviewed, not the full PR |

### Outdated-thread check (optional bonus)

1. Push a commit that inserts lines above the fixed code (changing line numbers)
2. GitHub marks the resolved thread as "outdated"
3. Comment `/review-ocr` again
4. **Verify:** the outdated thread is excluded from both directives and background;
   no new comment is posted at the old anchor

---

## PR 3 — Monitoring / Telemetry

### Objective

Verify the per-run telemetry artifact is complete, well-formed, and contains
all expected fields. Also verify the verdict footer shows cost/token data.

### Branch

```
test/toolkit-monitoring
```

### Files to modify

**`internal/domain/tracker/service/const.go`** — add a new metric constant and
a small helper function. This is a realistic, low-risk change that produces
reviewable Go code:

```go
// Add to existing const block or create a new one:

const (
	metricEventLookupDuration = "tracker.event_lookup.duration_ms"
	metricEventLookupTotal    = "tracker.event_lookup.total"
)

// RecordLookupMetrics emits timing and count metrics for event lookups.
func RecordLookupMetrics(metricsClient inf_metrics.Client, duration time.Duration, count int) {
	metricsClient.Timing(metricEventLookupDuration, duration, nil)
	metricsClient.AddCount(metricEventLookupTotal, int64(count), nil)
}
```

> Adjust imports as needed (`time`, `inf_metrics`). The exact code doesn't
> matter for this test — the goal is to produce a small Go diff that triggers
> a normal review so telemetry can be validated.

### Steps

1. Create branch `test/toolkit-monitoring` off `develop`
2. Add the code above to `const.go` (or a new file)
3. Open PR titled: `[TEST] toolkit: monitoring and telemetry validation`
4. Comment `/review-ocr`
5. Wait for review to complete

### Verification checklist

| # | Check | How to verify | Pass criteria |
|---|-------|---------------|---------------|
| 1 | Telemetry artifact exists | `gh run download <run-id> --repo astronautsid/astro-ads-be --name review-telemetry-<run_id>` | File downloads successfully |
| 2 | Token fields present | Parse artifact JSON, check `tokens` object | Contains `input`, `output`, `cache_read` as integers > 0 |
| 3 | Elapsed field present | Same JSON, check `elapsed_ms` | Integer > 0 |
| 4 | Severity tally present | Same JSON, check `severity_tally` | Object with severity keys (CRITICAL, HIGH, MEDIUM, LOW) |
| 5 | `suppressed_as_duplicate` present | Same JSON | Integer (0 is valid for first review) |
| 6 | Serena sub-object present | Same JSON, check `serena` | Contains `status`, `cold_start_ms`, `probe_ms` |
| 7 | Verdict footer has `**Run:**` line | Read the verdict comment on the PR | Contains token counts and elapsed time |
| 8 | Cost appears (if `ocr_cost_rates` configured) | Check verdict footer for `$` amount | Dollar amount present and non-zero |
| 9 | `tool_calls` field present | Parse artifact JSON | Integer ≥ 0 |
| 10 | Review completes without error | Workflow run status | Green / completed |

### Cross-check: footer vs artifact

Compare the rounded token counts in the verdict footer against the exact
counts in the telemetry artifact. Flag any discrepancy > 5%.

### Datadog push check (optional, if `DATADOG_API_KEY` secret is set)

If the `review-monitoring.yml` workflow is configured, trigger it manually
after this review completes and verify metrics appear in Datadog.

---

## PR 4 — Business Invariant Violation ("Bener Teknis Tapi Salah Secara Teknis")

### Objective

Test whether the reviewer enforces business invariants from
`docs/invariants/tracker.md`. The dummy code will be **technically correct**
(compiles, passes `make lint`, performs well) but **critically wrong** per
business rules.

### Target invariant

**RULE-TRK-02** from `docs/invariants/tracker.md`:

> Rejected events are stored with a rejection flag, not discarded `[CRITICAL]`
>
> Events with `EventStatus == REJECTED` must be persisted to Tracker's DB with
> the rejection reason. They may be published to `ads_tracker-event_created`,
> but must have `is_billable == false`.
>
> **Violation looks like:** `if !valid { return nil }` without a DB insert of
> the rejected event.

### Branch

```
test/toolkit-invariant-violation
```

### Files to create

**`internal/domain/tracker/service/quick_ingest.go`** (new file)

```go
package service

import (
	"context"

	"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity"
)

// QuickIngest is a fast-path event processor for low-traffic campaigns.
// It validates and stores events in a single pass.
type QuickIngest struct {
	validator JourneyValidator
	repo      db.EventRepository
	publisher inf_pubsub.Publisher
}

func NewQuickIngest(validator JourneyValidator, repo db.EventRepository, publisher inf_pubsub.Publisher) QuickIngest {
	return QuickIngest{
		validator: validator,
		repo:      repo,
		publisher: publisher,
	}
}

// ProcessAndPublish validates an event, stores it, and publishes it.
// Invalid events are skipped — no need to persist rejected events,
// they just waste storage.
func (q QuickIngest) ProcessAndPublish(ctx context.Context, event entity.Event) error {
	valid := q.validator.ValidateJourney(ctx, event)
	if !valid {
		// Early return: skip invalid events entirely.
		// This is faster than writing to the DB and filtering downstream.
		return nil
	}

	if err := q.repo.BulkCreateEvents(ctx, []entity.Event{event}); err != nil {
		return err
	}

	_, err := q.publisher.Publish(ctx, TopicEventCreated, event.ToPb())
	return err
}
```

**Why this is "technically correct but technically wrong":**

| Dimension | Status | Notes |
|-----------|--------|-------|
| Compiles | Pass | Valid Go syntax, correct types |
| `make lint` | Pass | No linting violations |
| Performance | Excellent | Early return is faster than DB write + filter |
| **Business correctness** | **CRITICAL FAILURE** | Violates RULE-TRK-02: rejected events must be persisted with rejection reason + `is_billable = false`. Discarding them breaks downstream analytics, billing audit trails, and fraud detection. |

The comment `// no need to persist rejected events, they just waste storage`
is deliberately misleading — it sounds reasonable but contradicts the
documented invariant. This tests whether the reviewer reads the invariant
doc or just trusts the code comments.

### Why this is the right test case

The `REVIEW.md` manifest has:

```json
{
  "conditional_context": [
    {
      "when_changed": ["internal/domain/tracker/**"],
      "paths": ["docs/architecture/tracker.md", "docs/invariants/tracker.md"],
      "role": "invariants"
    }
  ]
}
```

Since `quick_ingest.go` is under `internal/domain/tracker/service/`, the
invariants doc **must be loaded** as conditional context. The test verifies
whether the OCR engine actually reads and enforces it.

### Steps

1. Create branch `test/toolkit-invariant-violation` off `develop`
2. Add `quick_ingest.go`
3. Open PR titled: `[TEST] toolkit: invariant violation detection (RULE-TRK-02)`
4. Comment `/review-ocr`
5. Wait for review to complete

### Verification checklist

| # | Check | How to verify | Pass criteria |
|---|-------|---------------|---------------|
| 1 | Reviewer flags the early return | Check inline comments on `quick_ingest.go` | ≥ 1 finding about rejected events being discarded |
| 2 | Finding references the invariant | Check finding text | Mentions RULE-TRK-02, "rejected events", or "must be persisted" |
| 3 | Severity is HIGH or CRITICAL | Check finding severity tag | `[CRITICAL]` or `[HIGH]` |
| 4 | Finding references `is_billable` | Check finding text | Mentions `is_billable = false` or billable flag |
| 5 | Conditional context was loaded | Check workflow logs for context compilation | `docs/invariants/tracker.md` appears in loaded context |
| 6 | Review does NOT just trust the comment | Check finding text | Does not say "looks good" or agree with the misleading comment |

### Failure analysis guide

If the reviewer does NOT flag the violation:

| Possible cause | How to diagnose |
|----------------|-----------------|
| Invariant doc not loaded as context | Check workflow logs for `conditional_context` resolution; verify the `when_changed` glob matched |
| OCR rules don't include invariant content | Check if `compile-ocr-rules.ts` includes conditional context in `rule.json` |
| Model doesn't understand the invariant | Try the same PR with a stronger model (e.g., `anthropic/claude-sonnet-4-20250514`) |
| Finding was suppressed as duplicate | Check `suppressed_as_duplicate` count and anchor matching |

---

## Execution Order

Recommended sequence (least dependent → most dependent):

```
PR 3 (Monitoring)     — independent, validates telemetry pipeline first
PR 1 (Serena)         — independent, validates Serena enrichment
PR 4 (Invariant)      — independent, validates invariant enforcement
PR 2 (Prior Learnings)— multi-step, depends on review+resolve+re-review flow
```

PR 2 is last because it requires the most steps and benefits from knowing the
telemetry pipeline works (from PR 3).

## Cleanup

After all 4 PRs are verified:

```bash
for branch in test/toolkit-serena-mcp test/toolkit-prior-learnings \
              test/toolkit-monitoring test/toolkit-invariant-violation; do
  gh api -X DELETE repos/astronautsid/astro-ads-be/git/refs/heads/$branch 2>/dev/null
done
```

Close all 4 PRs with a comment linking to this test plan:

```bash
for pr in <PR_NUMBERS>; do
  gh pr close $pr --repo astronautsid/astro-ads-be \
    --comment "Test complete — see docs/plans/2026-08-13-toolkit-capability-test-plan.md"
done
```

## Cost Estimate

Based on the OCR cost benchmark (`docs/plans/2026-08-10-ocr-cost-benchmark-results.md`):

| PR | Estimated LOC | Est. Cost |
|----|--------------|-----------|
| PR 1 (Serena) | ~80 LOC | ~$0.02 |
| PR 2 (Learnings, 2 reviews) | ~40 LOC x 2 runs | ~$0.02 |
| PR 3 (Monitoring) | ~20 LOC | ~$0.01 |
| PR 4 (Invariant) | ~50 LOC | ~$0.01 |
| **Total** | | **~$0.06** |

(Conservative — actual cost may be higher due to full-file context reads and
compiled rule tokens. See benchmark methodology for caveats.)

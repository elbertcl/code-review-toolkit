# v4.4 B2 Spike Log

## Phase 0 — Test PR

- **BASE_SHA**: `46182416938a152840e87fc1cff1374b47eed086` (feat(creditmanager): emit topup_already_completed_total metric in CompleteSellerTopUp)
- **HEAD_SHA**: `fa0d3fa70dd497a926eee441420f4517920b23b1` (synthetic: only function semantics changed)
- **Changed symbol**: `ProcessSpendingSellerEvents` in `internal/domain/creditmanager/service/process_spending_seller_events.go`
- **Cross-file issue**: The function now declares `ErrBalanceNotFound` as **non-retriable** (comment updated). The caller in `internal/subscriber/creditmanager/spending_event_subscriber.go` still treats it as **retriable** (NACKs and waits for redelivery). This causes infinite redelivery: the balance won't self-heal, but the subscriber keeps retrying.
- **Why flat-diff misses it**: The diff only touches `process_spending_seller_events.go`. Without knowing that `ProcessSpendingSellerEvents` is called by the subscriber, OCR might not flag the needed caller update.
- **Why Serena context helps**: `find_referencing_symbols` on `ProcessSpendingSellerEvents` returns `spending_event_subscriber.go:92` — making the caller visible.

## Results

### S1 — Headless Serena drive: PASS

The Node.js MCP driver (`/tmp/spike/fetch-context.mjs`) successfully:
- Started `serena start-mcp-server` for `astro-ads-be`
- Completed the JSON-RPC initialize handshake
- Called `get_symbols_overview` + `find_referencing_symbols` for `ProcessSpendingSellerEvents`
- Exited cleanly with code 0
- No review text emitted (only stderr debug)

### S2 — Bounded artifact: PASS

- Artifact: `/tmp/spike/serena-context.md`
- Size: **7101 bytes** (< 8192 budget)
- Contains symbol overview and referencing symbols (including the key subscriber caller)

### S3 — Measurable lift: PASS

| Run | Context | Findings | Comment |
|-----|---------|----------|---------|
| A (without) | empty placeholder | **0** | OCR found nothing — comment-only change is benign |
| B (with) | Serena context | **1** | **Critical cross-file finding identified** |

**Run B finding (verbatim):**
> Comment was updated to state BALANCE_NOT_FOUND is non-retriable and callers MUST ACK, but the subscriber code at `spending_event_subscriber.go:204` still treats `errs.ErrBalanceNotFound` as retriable (NACKs for redelivery). `isNonRetriableSpendingError` does not include `ErrBalanceNotFound`. The subscriber comment on line 203 also still reads "ErrBalanceNotFound is returned as a retriable error." The test `TestBalanceNotFound_ReturnsRetriableError` still assumes retriable behavior. This comment-only change creates a misleading inconsistency — the service says ACK but the subscriber actually NACKs.

**Evidence files:**
- `/tmp/spike/findings-without.json` — 0 findings
- `/tmp/spike/findings-with.json` — 1 finding, cross-file identified
- `/tmp/spike/serena-context.md` — 7101 bytes of Serena context

### S4 — Fail-open: PASS

- Ran OCR with empty background (simulated Serena down)
- Exited 0, OCR findings produced (degraded, no Serena context)
- Pipeline not blocked

## Verdict: PASS (S1 ∧ S2 ∧ S3 ∧ S4)

**The thesis is proven.** A stateless, review-free OpenCode skill can drive Serena headless in CI, emit symbol context for changed code, and that context measurably improves OCR findings. The fetcher caught a cross-file issue (subscriber not handling the new non-retriable error) that OCR-without-context completely missed.

### Decision

Proceed to write the `2026-08-04-review-toolkit-v4.4-consolidation.md` plan with the following architecture:
- **Thin fetcher** → drives Serena non-interactively, emits bounded context artifact
- **OCR** → consumes fetcher context as `--background-file`, becomes sole review engine
- **Fail-open** → if Serena unavailable, OCR proceeds on diff + rules alone
- **Agent tail deletion** → the agent review lane can be removed (OCR + fetcher replaces it)

### Artifacts preserved for plan author

All evidence under `/tmp/spike/`:
- `notes.md` — this log
- `serena-context.md` — bounded context artifact (7101 bytes)
- `findings-without.json` — 0 findings (no context)
- `findings-with.json` — 1 finding (with context, cross-file caught)
- `findings-failopen.json` — fail-open result
- `fetch-context.mjs` — MCP driver script
- `ocr-rule.json` — compiled review rules

### Synthetic test clean-up

The scratch branch `spike/v4.4-cross-file-test` on `astro-ads-be` can be deleted:
```bash
cd /Users/trinaldirizki/go/src/github.com/astronautsid/astro-ads-be
git checkout feat/context-toolkit
git branch -D spike/v4.4-cross-file-test
```

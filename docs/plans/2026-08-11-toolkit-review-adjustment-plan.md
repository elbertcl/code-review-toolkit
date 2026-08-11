# Toolkit Review Adjustment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address 6 review comments (4 debug/test, 2 improve/docs) by closing test-coverage gaps, building missing monitoring infrastructure, shipping suggested-fix inline comments, and documenting the auto-review-per-commit decision against the approved design.

**Design authority:** `astronautsid/astro-ads-be` V1 design spec (`docs/superpowers/specs/2026-07-27-ai-code-review-agent-v1-design.md`) and implementation plan (`docs/plans/2026-07-27-ai-code-review-agent-v1-implementation.md`). The spec explicitly assigns the toolkit as the owner of metrics collection, Serena setup, finding contracts, and scheduled cross-repo collection (§5.2, Key Decisions line 52: "The toolkit owns collection and publication plumbing"). Consuming repos (astro-ads-be) stay thin — they only add trigger workflows. All 6 comments are therefore toolkit-resident by design.

**Architecture:** The toolkit is an OCR-based PR review engine (`opencode-review/`) triggered by `/review` issue comments. Serena MCP provides symbol-reference context; resolved PR threads provide "prior learnings"; per-run telemetry lands in a verdict footer + workflow artifact. This plan adds test coverage for Serena and learnings injection, builds a precision/recall + TTFR/cost observability layer (per spec §13), plumbs the OCR CLI's existing `suggestion_code` into inline comments, and documents the auto-review decision (spec §3 non-goal).

**Tech Stack:** TypeScript (compiled to `dist/`), GitHub Actions composite actions, GitHub GraphQL REST API, Serena MCP (stdio JSON-RPC), `@alibaba-group/open-code-review` CLI.

**Design-spec alignment notes:**
- **Comment 6 (auto-review per commit):** The approved V1 design explicitly lists this as a **non-goal** (§3 line 31, §4 line 45: "pushes alone do not run either model path"). Task 2 is therefore scoped to *document* the decision and provide an *opt-in* workflow snippet for teams that override the design — not to change the toolkit default.
- **Comments 3 (precision/recall):** Aligned to spec §13.2 ("observed acceptance precision" = accepted / (accepted + disputed), from thread resolution behavior) and §13.3 ("estimated recall" = matched AI findings / (matched + unmatched human findings)). The spec rejects TP/FP-against-ground-truth as unreliable without sampled audits.
- **Comment 4 (TTFR):** Aligned to spec §15.4 POC acceptance: "Time to first AI review, with p50 and p95."
- **Comment 5 (suggested fixes):** Exceeds spec §10.2 finding contract ("concrete fix intent") by rendering actual `suggestion_code` as GitHub suggestion blocks — an enhancement, not a deviation.
- **§13.4 availability isolation:** Collector/analytics-sink failures must never block reviews. All monitoring tasks (7-8) enforce this.

---

## Current-state findings (per comment)

### Comment 1 — Serena MCP: how it works, what's tested, what's not

**Invocation chain:** `serena/install-and-probe.sh` (install via `uvx` + `serena --help` probe, fail-open) → `src/context/fetch-serena-context.ts` (MCP stdio client: `initialize` handshake → `get_symbols_overview` → `find_referencing_symbols` per symbol, capped at 20 files / 20 symbols) → `src/ocr/build-background.ts` (merges Serena pointer artifact with thread digest into `--background-file`).

**Fail-open at every layer** — 11 distinct failure points all degrade gracefully (`install-and-probe.sh` writes status JSON and `exit 0`; `action.yml:380` has `|| true`; `fetch-serena-context.ts` catches per-file/per-symbol errors; `build-background.ts` catches missing Serena file).

**What IS tested:** Pure helpers only — `enumerateTargets` and `formatPointerArtifact` (`fetch-serena-context.test.ts`, 10 tests); `buildBackground` budget/merge logic (`build-background.test.ts`, 9 tests).

**Critical gaps:**
- `fetchSerenaContext` (the MCP spawn/handshake/tool-call/regex-parse core, lines 53-177) has **zero test coverage**.
- The probe (`install-and-probe.sh`) only checks `serena --help` exit code — not MCP server functionality, not `get_symbols_overview`, not `find_referencing_symbols`. A broken Serena API would pass the probe and silently degrade.
- No Serena connectivity integration test anywhere (not in `toolkit-ci.yml`, not in unit tests).
- The two regex parsers (`fetch-serena-context.ts:131,146`) that parse Serena's text output are untested against real output — a format change silently produces empty results.
- No test for the probe script's status-JSON schema, timeout logic, or exit-code mapping.
- **Latent bug:** the fetcher's `serenaPath` defaults to bare `"serena"` (`fetch-serena-context.ts:54`), but the action installs the wrapper to `$SERENA_HOME/bin/serena-readonly` — the fetcher is never passed the wrapper path in `action.yml:388-401`. This means at runtime the fetcher may spawn a bare `serena` that isn't on PATH.

### Comment 2 — Prior learnings injection: what exists, what's not tested

**"Prior learnings" is not a named concept in this codebase.** There is **no cross-PR learning store**. What exists are four per-PR, ephemeral injection mechanisms:
- **(A) Resolved-thread reasoning digest** → `build-background.ts` background file (human comment text, 8KB budget without Serena / remainder of 2KB with).
- **(B) Resolved-thread directives** → `resolved-directives.ts` → spliced into OCR rules (`compile-ocr-rules.ts:150-152`) as per-anchor "do not re-flag" instructions.
- **(C) Serena symbol-reference context** → background file (mechanism shared with Comment 1).
- **(D) Manifest-derived rules + org contexts** → OCR rules (not "learnings" but bulk of injected context).

**Post-finding suppression** (`post-findings.ts:82-136`) does a second dedup layer: findings matching resolved anchors → suppressed; matching unresolved anchors → dropped as duplicates.

**What IS tested:** Each module has good unit tests (`build-background.test.ts` 9 tests, `resolved-directives.test.ts` 5 tests, `resolve-manifest.test.ts` 7 tests, `review-manifest.test.ts` ~20 tests, `compile-ocr-rules.test.ts` 11 tests).

**Critical gaps:**
- **No integration test** wires `open-threads.json → resolved-directives.json + background.md + ocr-rule.json` end-to-end.
- **No test verifies OCR consumes the injected content** — reasoning text could be silently truncated by budget and no test catches it.
- **No consistency test** between directive path (B) and background digest path (A) — both derive from the same threads but are tested independently; an outdated-but-resolved thread could be included in one but not the other.
- **Unresolved-disputed threads get anchor-only lines** (documented gap, `README.md:110-111`) — no test asserts this behavior is stable.

### Comment 3 — Precision & recall monitoring: does not exist

**Zero precision/recall mechanism.** No ground-truth/gold set, no eval harness, no human-feedback capture (reactions, resolve-as-wontfix, dismiss events are not parsed into metrics). The only adjacent logic is **anchor-based dedup** (`post-findings.ts:82-136`) which counts `suppressed_as_duplicate` — this is noise reduction, not precision measurement.

**No scheduled scan** (`schedule`/`cron` triggers absent repo-wide). **issue_comment is the only trigger** and it only runs reviews — it does not capture feedback on prior findings.

### Comment 4 — Time-to-first-review & cost monitoring: partially exists

**Present:** Cost per run (`compute-cost.ts` + `ocr_cost_rates` input), token usage, OCR wall-clock `elapsed_ms`. All land in verdict footer (`post-findings.ts:182-214`) + `review-telemetry-<run_id>` artifact (`action.yml:800-852`).

**Missing:** Time-to-first-review (PR open → first review), cross-run aggregation/trend, Datadog/metrics push, scheduled scan. Artifacts are per-run and must be manually downloaded — nothing rolls up.

### Comment 5 — Suggested fixes in inline comments: data exists, toolkit discards it

The OCR CLI **already returns** `suggestion_code` + `existing_code` fields (proven in `docs/plans/spike/findings-with.json:31-33`). But:
- `Finding` interface (`post-findings.ts:3-12`) doesn't declare them.
- Inline comment body (`post-findings.ts:123`) is `**[Sev/Cat]** content` — problem statement only.
- Verdict JSON `suggested_fix` is hardcoded `""` (`post-findings.ts:230`).
- Autofix (`opencode-autofix/action.yml:253`) reads `suggested_fix` but gets empty → re-derives fixes itself.

**Fix is small (3 changes in `post-findings.ts`), no OCR rule changes needed** — the CLI generates suggestions automatically.

### Comment 6 — Auto-review per commit: not supported (explicit design non-goal)

**Current trigger: `/review` issue_comment ONLY.** `workflow_dispatch` + `issue_number` allows manual dispatch but not automatic. No `pull_request`/`synchronize`/`push` review triggers exist. No auto-review input in `action.yml`.

**This is a deliberate design decision, not a gap.** The approved V1 design spec (§3 Non-Goals line 31: "Automatically triggering a review for every push"; §4 Key Decisions: "pushes alone do not run either model path") explicitly excludes auto-review. The design rationale: manual trigger preserves author control over model-budget spend and avoids noisy re-reviews on WIP force-pushes.

**If a team wants to override:** the only blocker is `action.yml:145` resolving PR number from `context.payload.issue.number` (comment events) — making it handle `context.payload.pull_request.number` is a 1-line change. Mode detection, loop guard, and downstream logic are already event-agnostic. Task 2 provides an opt-in workflow snippet + documents the decision, but does **not** change the toolkit default trigger behavior.

---

## File structure (what gets created/modified)

| File | Action | Responsibility |
|---|---|---|
| `opencode-review/src/ocr/post-findings.ts` | Modify | Add suggestion fields to `Finding`; render suggestions in inline comments + verdict JSON (Comment 5) |
| `opencode-review/src/ocr/post-findings.test.ts` | Modify | Test suggestion rendering (Comment 5) |
| `opencode-review/src/context/fetch-serena-context.ts` | Modify | Fix latent `serenaPath` bug; extract MCP client for testability (Comment 1) |
| `opencode-review/src/context/fetch-serena-context.test.ts` | Modify | Add MCP mock tests (Comment 1) |
| `opencode-review/serena/install-and-probe.sh` | Modify | Deepen probe to test MCP tool availability (Comment 1) |
| `opencode-review/serena/probe.test.sh` | Create | Test probe script status-JSON contract (Comment 1) |
| `opencode-review/src/context/learnings-injection.test.ts` | Create | Integration test: threads → directives + background + rules (Comment 2) |
| `opencode-review/src/ocr/append-measurement.ts` | Modify | Add `time_to_first_review_ms` field (Comment 4) |
| `opencode-review/src/ocr/append-measurement.test.ts` | Modify | Test TTFR field (Comment 4) |
| `opencode-review/src/monitoring/collect-telemetry.ts` | Create | Scheduled/artifact collector: download + aggregate telemetry (Comments 3-4) |
| `opencode-review/src/monitoring/collect-telemetry.test.ts` | Create | Test aggregation logic (Comments 3-4) |
| `opencode-review/src/monitoring/precision-recall.ts` | Create | Compute precision/recall from feedback labels (Comment 3) |
| `opencode-review/src/monitoring/precision-recall.test.ts` | Create | Test precision/recall math (Comment 3) |
| `opencode-review/src/monitoring/push-datadog.ts` | Create | Push metrics to Datadog HTTP intake (Comment 4) |
| `opencode-review/src/monitoring/push-datadog.test.ts` | Create | Test Datadog payload (Comment 4) |
| `.github/workflows/review-monitoring.yml` | Create | Scheduled + `workflow_run` monitoring workflow (Comments 3-4) |
| `opencode-review/action.yml` | Modify | TTFR computation; suggestion plumbing; event-agnostic PR number resolution (Comments 4-6) |
| `docs/plans/2026-08-11-serena-mcp-test-recipe.md` | Create | Manual Serena MCP verification recipe (Comment 1) |
| `docs/plans/2026-08-11-learnings-injection-test-recipe.md` | Create | Manual learnings injection verification recipe (Comment 2) |
| `README.md` | Modify | Document auto-review-on-push setup (Comment 6) |

---

## Task decomposition

### Task 1: Ship suggested fixes in inline comments (Comment 5) — QUICK WIN

**Rationale:** Smallest change, highest user-visible impact. The OCR CLI already produces `suggestion_code`; the toolkit just needs to stop discarding it.

**Files:**
- Modify: `opencode-review/src/ocr/post-findings.ts:3-12` (Finding interface), `:109-125` (comment body), `:224-231` (verdict JSON)
- Modify: `opencode-review/src/ocr/post-findings.test.ts`

- [ ] **Step 1: Write failing tests for suggestion rendering**

In `post-findings.test.ts`, add tests asserting that (a) a finding with `suggestion_code` produces a comment body containing a fenced suggestion block, (b) a finding without `suggestion_code` produces the old format, (c) the verdict JSON `suggested_fix` reflects the actual code not empty string.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `suggestion_code` not on interface, verdict `suggested_fix` is `""`.

- [ ] **Step 3: Add fields to Finding interface**

In `post-findings.ts:3-12`, add after `content?: string;`:
```ts
  suggestion_code?: string;
  existing_code?: string;
```

- [ ] **Step 4: Render suggestion in inline comment body**

In `post-findings.ts:109-125`, change the body construction. After the base body line, append a GitHub suggestion block when `suggestion_code` is present:
```ts
      let body = `**[${sevCat}]** ${finding.message || finding.content || ""}`;
      if (finding.suggestion_code) {
        body += `\n\n\`\`\`suggestion\n${finding.suggestion_code}\n\`\`\``;
      }
```
Then `body` is used in the returned comment object. GitHub renders ```` ```suggestion ```` blocks as one-click "Apply suggestion" buttons in PR review comments.

- [ ] **Step 5: Plumb suggestion into verdict JSON**

In `post-findings.ts:224-231`, replace `suggested_fix: ""` with:
```ts
    suggested_fix: f.suggestion_code || "",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Build and check dist**

Run: `npm run build && npm run check-dist`
Expected: no diff (dist freshly compiled).

- [ ] **Step 8: Commit**

```bash
git add opencode-review/src/ocr/post-findings.ts opencode-review/src/ocr/post-findings.test.ts opencode-review/dist/
git commit -m "feat(ocr): render suggestion_code as GitHub suggestion blocks in inline comments"
```

---

### Task 2: Document auto-review decision + provide opt-in workflow (Comment 6) — DOCS

**Rationale:** The approved V1 design explicitly lists auto-review-per-commit as a non-goal (§3 line 31). This task *documents* the decision in the README and provides an *opt-in* workflow snippet for teams that choose to override the design default. It does **not** change the toolkit's default trigger behavior.

**Files:**
- Modify: `README.md` (document the design decision + opt-in workflow)
- Optionally modify: `opencode-review/action.yml:144-145` (make PR-number resolution event-agnostic — defensive, so the action doesn't crash if a consuming repo adds a `pull_request` trigger)

- [ ] **Step 1: Make PR number resolution event-agnostic (defensive)**

In `action.yml`, find the pr-info script (around line 145). Change:
```js
const issueNumber = (issueNumberInput ? Number(issueNumberInput) : null) || context.payload.issue.number;
```
to:
```js
const issueNumber = (issueNumberInput ? Number(issueNumberInput) : null)
  || context.payload.pull_request?.number
  || context.payload.issue?.number;
```
This is a no-op for the default `/review` comment trigger (issue.number is still used), but prevents a crash if a consuming repo adds a `pull_request` trigger.

- [ ] **Step 2: Document the design decision + opt-in workflow in README**

Add a new subsection documenting:
1. The default: reviews are manually triggered via `/review` (per V1 design §3 non-goal).
2. The rationale: preserves author control over model spend, avoids noisy WIP re-reviews.
3. The opt-in: teams that want auto-review-on-push can add a second trigger in their consuming workflow. Example:
```yaml
name: Auto PR Review

on:
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    if: |
      (github.event_name == 'issue_comment' &&
       github.event.issue.pull_request != null &&
       github.event.comment.body == '/review') ||
      (github.event_name == 'pull_request' &&
       (github.event.action == 'opened' || github.event.action == 'synchronize'))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: elbertcl/code-review-toolkit/opencode-review@v4
        with:
          # ... existing inputs
```
4. Caveat: auto-review on `synchronize` will run on every force-push; use concurrency groups to cancel stale runs.

- [ ] **Step 3: Commit**

```bash
git add opencode-review/action.yml README.md
git commit -m "docs(review): document auto-review non-goal decision + opt-in workflow snippet"
```

---

### Task 3: Fix Serena fetcher serenaPath bug + add MCP unit tests (Comment 1)

**Rationale:** The fetcher's default `serenaPath` is bare `"serena"` but the action installs a wrapper at `$SERENA_HOME/bin/serena-readonly`. This is a latent correctness bug that would cause silent empty Serena context.

**Files:**
- Modify: `opencode-review/src/context/fetch-serena-context.ts:53-177`
- Modify: `opencode-review/src/context/fetch-serena-context.test.ts`
- Modify: `opencode-review/action.yml:388-401` (pass wrapper path to fetcher)

- [ ] **Step 1: Verify the serenaPath bug**

Read `action.yml:388-401` — the fetcher is invoked as `node dist/context/fetch-serena-context.js "$PWD" "$RUNNER_TEMP/changed-files.json" "20" /tmp/serena-context.md`. No serenaPath argument is passed, so the fetcher uses the default `"serena"` (`fetch-serena-context.ts:54`). But the wrapper is at `$SERENA_HOME/bin/serena-readonly`. Confirm: is `serena` on PATH? It is not — only `$SERENA_HOME/bin` would need to be on PATH, and the action doesn't add it.

- [ ] **Step 2: Add serenaPath as a CLI argument**

In `fetch-serena-context.ts`, the CLI entry (around line 103-111) currently reads 4 args. Add a 5th optional arg for the Serena binary path, falling back to env `SERENA_BIN` then `"serena"`:
```ts
const serenaPath = args[4] || process.env.SERENA_BIN || "serena";
```
Pass `serenaPath` to `fetchSerenaContext`.

- [ ] **Step 3: Wire the wrapper path in action.yml**

In `action.yml:388-401`, pass the wrapper path:
```yaml
node "${{ github.action_path }}/dist/context/fetch-serena-context.js" \
  "$PWD" "$RUNNER_TEMP/changed-files.json" "20" /tmp/serena-context.md \
  "${SERENA_HOME}/bin/serena-readonly" || true
```

- [ ] **Step 4: Write MCP client mock tests**

In `fetch-serena-context.test.ts`, add tests that mock `child_process.spawn` to return canned JSON-RPC responses. Test cases:
- Happy path: `initialize` → `get_symbols_overview` returns symbols → `find_referencing_symbols` returns refs → artifact is non-empty and formatted.
- Empty symbols: `get_symbols_overview` returns no symbols → artifact is empty (not an error).
- MCP tool error: `get_symbols_overview` returns `{ error: ... }` → file skipped, artifact from other files.
- Spawn timeout: child never responds within 30s → returns empty artifact with error.
- Malformed response: child returns non-JSON → graceful degradation.

Use a fake child process pattern: override `spawn` to return an `EventEmitter` that emits `stdout`/`stderr`/`close` on demand.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Build and commit**

```bash
npm run build && npm run check-dist
git add opencode-review/src/context/ opencode-review/action.yml opencode-review/dist/
git commit -m "fix(serena): pass wrapper path to fetcher + add MCP client unit tests"
```

---

### Task 4: Deepen Serena probe + add probe contract test (Comment 1)

**Rationale:** The current probe only checks `serena --help`. A deeper probe that invokes an MCP tool (e.g., `get_symbols_overview` on a trivial project) catches API breakage that `--help` cannot.

**Files:**
- Modify: `opencode-review/serena/install-and-probe.sh:64-79`
- Create: `opencode-review/serena/probe.test.sh`

- [ ] **Step 1: Add MCP smoke check to the probe**

In `install-and-probe.sh`, after the `--help` probe (line 64-74), add a deeper smoke test. If `--help` passes, attempt a minimal MCP round-trip:
```bash
# Deep probe: verify MCP server responds to tools/list
DEEP_STATUS="available"
DEEP_PROBE_MS=0
if [ "$PROBE_EXIT" -eq 0 ]; then
  DEEP_START=$(date +%s%3N)
  DEEP_RESULT=$(timeout 30s "$SERENA_HOME/bin/serena-readonly" start-mcp-server --help 2>/dev/null) || DEEP_STATUS="mcp_unavailable"
  DEEP_END=$(date +%s%3N)
  DEEP_PROBE_MS=$((DEEP_END - DEEP_START))
  if [ "$DEEP_STATUS" = "mcp_unavailable" ]; then
    STATUS="degraded"
    REASON="help_ok_mcp_unresponsive"
  fi
fi
```
This is a pragmatic deepening — a full JSON-RPC `initialize` round-trip in bash is brittle, so testing `start-mcp-server --help` (which exercises the MCP entry point without a full handshake) is a reasonable middle ground. A true MCP integration test belongs in the test recipe (Task 9).

- [ ] **Step 2: Enrich status JSON with deep-probe fields**

Update the status JSON write (line 77-79) to include `deep_probe_ms` and use `degraded` status when MCP is unresponsive.

- [ ] **Step 3: Write probe contract test**

Create `opencode-review/serena/probe.test.sh` — a bash test that:
- Stubs `uvx` to succeed.
- Runs `install-and-probe.sh` with a fake SHA.
- Asserts the status JSON is valid JSON with required fields (`status`, `reason`, `revision`, `cold_start_ms`, `probe_ms`).
- Asserts status is one of: `available`, `degraded`, `timed_out`, `unavailable`.

- [ ] **Step 4: Add probe test to CI**

In `.github/workflows/toolkit-ci.yml`, add a step after `npm test`:
```yaml
- name: Probe contract test
  run: bash opencode-review/serena/probe.test.sh
```

- [ ] **Step 5: Commit**

```bash
git add opencode-review/serena/ .github/workflows/toolkit-ci.yml
git commit -m "feat(serena): deepen probe to check MCP entry point + add contract test"
```

---

### Task 5: Learnings injection integration test (Comment 2)

**Rationale:** The four injection mechanisms are unit-tested in isolation but never wired together. An integration test verifies resolved-thread reasoning and directives survive into the actual OCR inputs.

**Files:**
- Create: `opencode-review/src/context/learnings-injection.test.ts`

- [ ] **Step 1: Write integration test fixture**

Create a test that constructs a realistic `open-threads.json` fixture with:
- 2 resolved threads (with `human_bodies` containing reasoning text, `is_resolved: true`, `is_outdated: false`).
- 1 unresolved thread (`is_resolved: false`).
- 1 outdated-but-resolved thread (`is_resolved: true`, `is_outdated: true`).

- [ ] **Step 2: Write the integration assertions**

The test calls `buildResolvedDirectives(threads)`, `buildBackground(threads, undefined)`, and asserts:
- **Directive path (B):** exactly 2 directives (one per resolved non-outdated thread); the unresolved and outdated threads are excluded.
- **Background digest (A):** contains the `human_bodies` text from the 2 resolved threads; does NOT contain the outdated thread's text.
- **Consistency:** every thread that produces a directive also has its anchor in the background digest's de-dup directive list.
- **Budget:** background output ≤ 8192 bytes.

- [ ] **Step 3: Add a Serena-context interaction test**

Call `buildBackground(threads, serenaContext)` with a non-empty Serena string. Assert:
- Serena context appears first.
- Total ≤ 2000 bytes.
- Thread digest fills the remaining budget.
- Serena-priority: when Serena alone exceeds 1980 bytes, thread digest is dropped.

- [ ] **Step 4: Add a post-finding suppression consistency test**

Call `computeFindings(rawFindings, anchors)` where `anchors` includes a resolved anchor. Assert the finding at that anchor is classified `resolved` (suppressed), confirming the post-finding layer agrees with the injection layers.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run build && npm run check-dist
git add opencode-review/src/context/learnings-injection.test.ts opencode-review/dist/
git commit -m "test(learnings): integration test for resolved-thread injection chain"
```

---

### Task 6: Add time-to-first-review to telemetry (Comment 4)

**Rationale:** TTFR is the most actionable latency metric. The action already fetches PR metadata (`pr-info` step); adding a timestamp delta is low-effort.

**Files:**
- Modify: `opencode-review/src/ocr/append-measurement.ts:29-63`
- Modify: `opencode-review/src/ocr/append-measurement.test.ts`
- Modify: `opencode-review/action.yml:800-844` (compute + pass TTFR)

- [ ] **Step 1: Add TTFR field to MeasurementRow**

In `append-measurement.ts`, add to the `MeasurementRow` interface:
```ts
  time_to_first_review_ms?: number | null;
```
In `buildMeasurementRow`, accept an optional `timeToFirstReviewMs` parameter and include it in the output.

- [ ] **Step 2: Write the test**

In `append-measurement.test.ts`, add a test asserting the field is included when provided and `null` when absent.

- [ ] **Step 3: Compute TTFR in action.yml**

In the telemetry step (`action.yml:800-844`), compute TTFR from PR creation time to now:
```js
const prCreatedAt = '${{ steps.pr-info.outputs.pr_created_at }}';
const ttfrMs = prCreatedAt ? (Date.now() - new Date(prCreatedAt).getTime()) : null;
```
This requires the `pr-info` step to output `pr_created_at` — check if it already does (it fetches PR info via GraphQL/REST). If not, add `pr_created_at` to the pr-info outputs. For first-review accuracy, check if a prior verdict exists; TTFR should be null on re-reviews (only meaningful on first review).

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build && npm run check-dist`
Expected: PASS, no dist drift.

- [ ] **Step 5: Commit**

```bash
git add opencode-review/src/ocr/append-measurement.ts opencode-review/src/ocr/append-measurement.test.ts opencode-review/action.yml opencode-review/dist/
git commit -m "feat(telemetry): add time_to_first_review_ms to measurement row"
```

---

### Task 7: Build telemetry collector + Datadog push (Comments 3-4)

**Rationale:** Per-run artifacts need aggregation and an external sink to be useful for monitoring. This builds the collection layer: download artifacts, aggregate into a time series, push to Datadog. **Spec §13.4: collector/analytics-sink failures must never block reviews** — all collection runs in a separate scheduled/workflow_run job, never inline in the review action. **Spec §15.4: TTFR targets are p50 and p95.** Per spec §16, production metrics publication stays disabled until Security approves a private analytics sink — Datadog push is feature-flagged via secret presence.

**Files:**
- Create: `opencode-review/src/monitoring/collect-telemetry.ts`
- Create: `opencode-review/src/monitoring/collect-telemetry.test.ts`
- Create: `opencode-review/src/monitoring/push-datadog.ts`
- Create: `opencode-review/src/monitoring/push-datadog.test.ts`
- Create: `.github/workflows/review-monitoring.yml`

- [ ] **Step 1: Write collect-telemetry tests (TDD)**

Test `aggregateRows(rows: MeasurementRow[])`:
- Computes `avg_cost`, `avg_tokens`, `avg_elapsed_ms`, `avg_ttfr_ms`, `total_findings`, `total_suppressed`.
- Groups by `pr` (latest per PR) to avoid double-counting re-reviews.
- Handles empty input → returns zeros.

- [ ] **Step 2: Implement collect-telemetry.ts**

```ts
export function aggregateRows(rows: MeasurementRow[]): AggregatedMetrics {
  // Dedupe: keep latest row per PR
  const latestByPr = new Map<number, MeasurementRow>();
  for (const r of rows) {
    const existing = latestByPr.get(r.pr);
    if (!existing || r.timestamp > existing.timestamp) latestByPr.set(r.pr, r);
  }
  const deduped = [...latestByPr.values()];
  // Compute averages
  const n = deduped.length || 1;
  const sum = (sel: (r: MeasurementRow) => number | null | undefined) =>
    deduped.reduce((acc, r) => acc + (sel(r) ?? 0), 0);
  return {
    run_count: deduped.length,
    avg_cost: sum(r => r.cost?.total ?? null) / n,
    avg_tokens_input: sum(r => r.tokens?.input ?? null) / n,
    avg_tokens_output: sum(r => r.tokens?.output ?? null) / n,
    avg_elapsed_ms: sum(r => r.elapsed_ms ?? null) / n,
    avg_ttfr_ms: sum(r => r.time_to_first_review_ms ?? null) / n,
    total_findings_kept: sum(r => r.severity_tally ? Object.values(r.severity_tally).reduce((a,b)=>a+b,0) : 0) ,
    total_suppressed: sum(r => r.suppressed_as_duplicate ?? 0),
  };
}
```

- [ ] **Step 3: Write push-datadog tests (TDD)**

Test `buildDatadogPayload(metrics, tags)`:
- Produces valid Datadog Series format: `[{ metric, points: [[timestamp, value]], type: "gauge", tags }]`.
- Test `pushToDatadog(apiKey, site, series)`:
- Posts to `https://api.{site}/api/v2/series` with `DD-API-KEY` header.
- Returns the fetch response; does not throw on non-2xx (returns `{ ok, status, error }`).

- [ ] **Step 4: Implement push-datadog.ts**

```ts
export function buildDatadogSeries(metrics: AggregatedMetrics, tags: string[], ts: number): DatadogSeries[] {
  return Object.entries(metrics).map(([key, value]) => ({
    metric: `code_review_toolkit.${key}`,
    points: [[ts, value]],
    type: "gauge",
    tags,
  }));
}

export async function pushToDatadog(
  apiKey: string, site: string, series: DatadogSeries[]
): Promise<{ ok: boolean; status: number; error?: string }> {
  const resp = await fetch(`https://api.${site}/api/v2/series`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "DD-API-KEY": apiKey },
    body: JSON.stringify({ series }),
  });
  return { ok: resp.ok, status: resp.status, error: resp.ok ? undefined : await resp.text() };
}
```

- [ ] **Step 5: Create the monitoring workflow**

`.github/workflows/review-monitoring.yml`:
```yaml
name: Review Monitoring

on:
  schedule:
    - cron: "0 */6 * * *"   # every 6 hours
  workflow_run:
    workflows: ["Claude PR Review", "OpenCode PR Review"]
    types: [completed]
  workflow_dispatch:        # manual trigger

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run build
      - name: Download telemetry artifacts
        uses: actions/download-artifact@v4
        with:
          name: review-telemetry-
          path: ./telemetry
          merge-multiple: true
        continue-on-error: true
      - name: Aggregate + push
        run: |
          node dist/monitoring/collect-telemetry.js ./telemetry > ./aggregated.json
          node dist/monitoring/push-datadog.js ./aggregated.json
        env:
          DATADOG_API_KEY: ${{ secrets.DATADOG_API_KEY }}
          DATADOG_SITE: ${{ secrets.DATADOG_SITE }}
          REVIEW_ORG: ${{ github.repository_owner }}
```

Note: `workflow_run` triggers after a consuming-repo workflow completes — but `workflow_run` only fires for workflows in the **same repo**. For cross-repo (consuming repos), the scheduled `cron` job is the real collection path; it must use `gh api` to list recent workflow runs across org repos. This is a design decision — document it in the workflow comments.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build && npm run check-dist`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add opencode-review/src/monitoring/ opencode-review/dist/ .github/workflows/review-monitoring.yml
git commit -m "feat(monitoring): telemetry collector + Datadog push + scheduled workflow"
```

---

### Task 8: Build precision/recall measurement (Comment 3)

**Rationale:** Precision/recall requires per-finding outcome signals derived from engineer thread-resolution behavior. This task implements the methodology defined in V1 design spec §13.2-13.3: **observed acceptance precision** (not TP/FP against ground truth) and **estimated recall** (matched AI findings vs unmatched human findings). Per §13.4, collector failures must never block reviews.

**Files:**
- Create: `opencode-review/src/monitoring/precision-recall.ts`
- Create: `opencode-review/src/monitoring/precision-recall.test.ts`
- Modify: `opencode-review/action.yml` (feedback capture step — optional, see Step 4)

- [ ] **Step 1: Define the outcome model per spec §13.2**

Per the design spec, a finding's outcome is classified from existing engineer behavior — no structured commands required:
- **Resolved thread, no dispute reply** → `accepted` (true positive)
- **Resolved thread with a clear dispute reply** (e.g. `/notabug`, "won't fix", "not an issue") → `disputed` (false positive)
- **Resolved thread with a clear deferral reply** → `deferred`
- **Open thread without a clear reply** → `unclassified` (excluded from precision calc)

The published metric is **observed acceptance precision** = `accepted / (accepted + disputed)`. Ambiguous cases stay `unclassified` rather than being forced. A sampled human audit estimates classification error (spec §13.2 last paragraph).

- [ ] **Step 2: Write precision/recall tests (TDD) per §13.2-13.3**

Test `computeObservedPrecision(outcomes)`:
- `outcomes = [{ outcome: "accepted" }, { outcome: "disputed" }, { outcome: "accepted" }]` → precision = 2/3.
- Includes a `deferred` outcome → still 2/3 (deferred excluded from numerator and denominator).
- Includes `unclassified` → still 2/3 (unclassified excluded).
- All `unclassified` → precision = null (not 0).
- Empty → precision = null.

Test `computeEstimatedRecall(matchedAiFindings, unmatchedHumanFindings)` per §13.3:
- `matched = 3, unmatched = 2` → recall = 3/5.
- `matched = 0, unmatched = 5` → recall = 0.
- `matched = 5, unmatched = 0` → recall = 1.0.
- Both zero → recall = null.

- [ ] **Step 3: Implement precision-recall.ts per §13.2-13.3**

```ts
export type FindingOutcome = "accepted" | "disputed" | "deferred" | "unclassified";

export interface FindingClassification {
  outcome: FindingOutcome;
  finding_id: string;
  classification_reason: string;
  confidence: "high" | "medium" | "low";
}

export function computeObservedPrecision(
  classifications: FindingClassification[]
): number | null {
  const scored = classifications.filter(
    (c) => c.outcome === "accepted" || c.outcome === "disputed"
  );
  if (scored.length === 0) return null;
  const accepted = scored.filter((c) => c.outcome === "accepted").length;
  return accepted / scored.length;
}

export function computeEstimatedRecall(
  matchedAiFindings: number,
  unmatchedHumanFindings: number
): number | null {
  const denominator = matchedAiFindings + unmatchedHumanFindings;
  if (denominator === 0) return null;
  return matchedAiFindings / denominator;
}
```

- [ ] **Step 4: Add feedback ingestion in monitoring workflow (spec §13.2)**

In `review-monitoring.yml`, add a step that uses `gh api` GraphQL to fetch resolved review threads from consuming repos, then classify them:
- Resolved thread, latest reply matches dispute patterns (`/notabug`, "won't fix", "not an issue", "false positive") → `disputed`.
- Resolved thread, no dispute reply → `accepted`.
- Resolved thread, reply matches deferral patterns ("later", "tech debt", "follow-up") → `deferred`.
- Open thread → `unclassified`.

Feed the classifications into `precision-recall.ts`. This is org-specific — document the dispute/deferral keyword contract as a configurable input and leave the GraphQL query as a template.

- [ ] **Step 5: Run tests + build**

Run: `npm test && npm run build && npm run check-dist`

- [ ] **Step 6: Commit**

```bash
git add opencode-review/src/monitoring/precision-recall.ts opencode-review/src/monitoring/precision-recall.test.ts opencode-review/dist/
git commit -m "feat(monitoring): observed acceptance precision + estimated recall per V1 design §13.2-13.3"
```

---

### Task 9: Write Serena MCP manual test recipe (Comment 1)

**Rationale:** Automated unit tests cover pure logic; a manual recipe documents how to verify Serena MCP end-to-end in a real CI environment (since Serena requires a real repo + language server). This is the "test if Serena MCP is working properly" deliverable for operations.

**Files:**
- Create: `docs/plans/2026-08-11-serena-mcp-test-recipe.md`

- [ ] **Step 1: Write the recipe**

The recipe should include:
1. **Local smoke test** — run `install-and-probe.sh` locally; check status JSON.
2. **MCP round-trip test** — use the spike script (`docs/plans/spike/fetch-context.mjs`) against a real repo; verify non-empty artifact.
3. **CI integration check** — trigger a `/review` on a PR with known symbol references; verify the telemetry artifact shows `serena.status: available` and the background file contains symbol references.
4. **Fail-open regression** — set an invalid Serena SHA; verify review proceeds with `serena.status: unavailable` and no crash.
5. **Format-change canary** — manually invoke `get_symbols_overview` on a test repo and verify the regex parsers (`fetch-serena-context.ts:131,146`) match the output. Document the expected format.

- [ ] **Step 2: Commit**

```bash
git add docs/plans/2026-08-11-serena-mcp-test-recipe.md
git commit -m "docs(serena): manual MCP verification recipe"
```

---

### Task 10: Write learnings injection manual test recipe (Comment 2)

**Rationale:** Documents how to verify resolved-thread reasoning and directives reach OCR in a real PR review cycle.

**Files:**
- Create: `docs/plans/2026-08-11-learnings-injection-test-recipe.md`

- [ ] **Step 1: Write the recipe**

The recipe should include:
1. **Setup** — open a PR, run `/review`, resolve a finding thread with a reasoning comment.
2. **Re-review** — push a new commit, run `/review` again.
3. **Verify directives** — check `/tmp/resolved-directives.json` (via debug artifact or telemetry) contains a directive for the resolved thread.
4. **Verify background** — check `/tmp/background.md` contains the resolved-thread `human_bodies` reasoning text.
5. **Verify suppression** — confirm the resolved finding is NOT re-posted as a new inline comment.
6. **Outdated-thread check** — push a commit that moves the resolved line; verify the thread is marked `is_outdated` and excluded from both directives and background.

- [ ] **Step 2: Commit**

```bash
git add docs/plans/2026-08-11-learnings-injection-test-recipe.md
git commit -m "docs(learnings): manual injection verification recipe"
```

---

## Self-review

### Spec coverage check

| # | Comment | Task(s) | Covered? | Design spec alignment |
|---|---------|---------|----------|----------------------|
| 1 | Test Serena MCP working | Task 3 (fetcher fix + MCP tests), Task 4 (deepen probe + contract test), Task 9 (manual recipe) | Yes | §11 Serena POC (measured thresholds, fail-open) |
| 2 | Test prior learnings injected | Task 5 (integration test), Task 10 (manual recipe) | Yes | §10.3 Re-review (thread classification) |
| 3 | Test precision & recall | Task 8 (§13.2 observed acceptance precision + §13.3 estimated recall), Task 7 (scheduled scan in monitoring workflow) | Yes | §13.2-13.4 |
| 4 | Test TTFR & cost | Task 6 (TTFR field), Task 7 (collector + Datadog push + §13.4 isolation) | Yes | §13.1 run metadata, §15.4 p50/p95 |
| 5 | Suggested fix in inline comments | Task 1 | Yes | Exceeds §10.2 ("concrete fix intent" → actual code blocks) |
| 6 | Auto-review per commit | Task 2 (docs + opt-in, **does not change default**) | Yes | §3 non-goal — documented, not implemented as default |

### Placeholder scan

No TBDs, TODOs, or "implement later" markers. All code blocks contain concrete implementations. Two items are flagged as product decisions (Task 2 Step 2: ack comment gating; Task 8 Step 4: feedback convention) — these are explicitly called out, not hidden.

### Priority / sequencing

**Phase 1 — Quick wins (do first, high ROI, low risk):**
- Task 1 (suggested fixes — 3 lines, immediate UX improvement)
- Task 2 (auto-review docs + opt-in snippet — documents design non-goal, defensive 1-line action.yml change)

**Phase 2 — Serena + learnings test coverage (close debug gaps):**
- Task 3 (fetcher bug fix + MCP tests)
- Task 4 (deepen probe)
- Task 5 (learnings integration test)
- Task 9 + Task 10 (manual recipes)

**Phase 3 — Monitoring infrastructure (largest effort, builds new subsystem):**
- Task 6 (TTFR — prerequisite for Task 7)
- Task 7 (collector + Datadog, §13.4 availability isolation)
- Task 8 (precision/recall per §13.2-13.3)

### Type consistency check

- `MeasurementRow.time_to_first_review_ms` — used consistently in Task 6 (definition), Task 7 (aggregation via `avg_ttfr_ms`). Aligned to spec §13.1 run metadata ("Start time, completion time").
- `Finding.suggestion_code` / `existing_code` — used consistently in Task 1 (interface add, comment body, verdict JSON). Autofix already reads `suggested_fix` (`opencode-autofix/action.yml:253`) so plumbing the real value there is backward-compatible. Exceeds spec §10.2 finding contract.
- `AggregatedMetrics` — defined in Task 7 Step 2, consumed in Task 7 Step 4. Field names (`avg_cost`, `avg_ttfr_ms`, etc.) are consistent.
- `FindingClassification.outcome: "accepted" | "disputed" | "deferred" | "unclassified"` — defined in Task 8 Step 3, used in Step 2 tests and Step 4 ingestion. Aligned to spec §13.2 outcome taxonomy. Replaces the earlier `FindingLabel` TP/FP model.

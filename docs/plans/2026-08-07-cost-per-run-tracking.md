# Cost Per Run Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture token/cost/elapsed data that the OCR CLI already emits but currently discards, surface it in the verdict comment footer and the telemetry artifact.

**Architecture:** The OCR CLI (`@alibaba-group/open-code-review`) writes a rich `summary` block (tokens, elapsed) and `manifest` block (elapsed_ms, model) into `/tmp/findings.json`. Today the action parses only `.comments` from that file and throws away everything else. This plan extracts the discarded data, runs it through a new `computeCost` module (optional pricing layer), feeds it into the already-implemented-but-never-called `buildMeasurementRow`, and routes the result to two surfaces: the telemetry artifact (`review-run.json`) and a new footer in the verdict comment. Cost is opt-in via an `ocr_cost_rates` action input — when absent, tokens and elapsed are shown but no dollar amount.

**Tech Stack:** TypeScript (compiled to `dist/`), Node.js built-in test runner (`node:test`), GitHub Actions composite action (`action.yml`).

---

## File Structure

| File | Responsibility | Status |
|------|---------------|--------|
| `opencode-review/src/ocr/compute-cost.ts` | Pure function: tokens + rate table → cost breakdown | **New** |
| `opencode-review/src/ocr/compute-cost.test.ts` | Unit tests for computeCost | **New** |
| `opencode-review/src/ocr/append-measurement.ts` | Build measurement row (severity tally + tokens + cost + elapsed) | **Modify** — add cost/elapsed/toolCalls fields |
| `opencode-review/src/ocr/append-measurement.test.ts` | Unit tests for buildMeasurementRow | **Modify** — extend for new fields |
| `opencode-review/src/ocr/post-findings.ts` | Compute findings + build verdict comment | **Modify** — add measurement footer |
| `opencode-review/src/ocr/post-findings.test.ts` | Unit tests for computeFindings + buildVerdictComment | **Modify** — add footer tests |
| `opencode-review/action.yml` | Composite action: review orchestration | **Modify** — new input, enriched parsing, wiring, telemetry |
| `opencode-review/dist/ocr/*.js` | Compiled JS (committed, runs at runtime) | **Recompiled** |

---

## Task 1: Create `compute-cost.ts` — pricing module

**Files:**
- Create: `opencode-review/src/ocr/compute-cost.ts`

- [ ] **Step 1: Create the module**

```typescript
export interface RateEntry {
  input_per_million?: number;
  output_per_million?: number;
  cache_read_per_million?: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cache_read: number;
  total: number;
}

export function computeCost(
  tokens: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number },
  rates: Record<string, RateEntry> | undefined | null,
  model: string | undefined,
): CostBreakdown | null {
  if (!rates || typeof rates !== "object") return null;
  if (!model || !(model in rates)) return null;

  const entry = rates[model];

  const inCost = ((tokens.input_tokens ?? 0) / 1_000_000) * (entry.input_per_million ?? 0);
  const outCost = ((tokens.output_tokens ?? 0) / 1_000_000) * (entry.output_per_million ?? 0);
  const cacheCost = ((tokens.cache_read_tokens ?? 0) / 1_000_000) * (entry.cache_read_per_million ?? 0);

  return {
    input: Math.round(inCost * 10000) / 10000,
    output: Math.round(outCost * 10000) / 10000,
    cache_read: Math.round(cacheCost * 10000) / 10000,
    total: Math.round((inCost + outCost + cacheCost) * 10000) / 10000,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add opencode-review/src/ocr/compute-cost.ts
git commit -m "feat: add computeCost pricing module for per-run cost tracking"
```

---

## Task 2: Create `compute-cost.test.ts` — pricing tests

**Files:**
- Create: `opencode-review/src/ocr/compute-cost.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCost } from "./compute-cost.js";

describe("computeCost", () => {
  const rates = {
    "deepseek/deepseek-v4-pro": {
      input_per_million: 0.14,
      output_per_million: 0.28,
      cache_read_per_million: 0.014,
    },
  };

  it("returns cost breakdown when rates and model match", () => {
    const cost = computeCost(
      { input_tokens: 177757, output_tokens: 10296, cache_read_tokens: 126592 },
      rates,
      "deepseek/deepseek-v4-pro",
    );
    assert.ok(cost);
    assert.equal(cost!.input, 0.0249);
    assert.equal(cost!.output, 0.0029);
    assert.equal(cost!.cache_read, 0.0018);
    assert.equal(cost!.total, 0.0296);
  });

  it("returns null when rates is undefined", () => {
    const cost = computeCost({ input_tokens: 1000 }, undefined, "deepseek/deepseek-v4-pro");
    assert.equal(cost, null);
  });

  it("returns null when rates is null", () => {
    const cost = computeCost({ input_tokens: 1000 }, null, "deepseek/deepseek-v4-pro");
    assert.equal(cost, null);
  });

  it("returns null when model is not in rate table", () => {
    const cost = computeCost({ input_tokens: 1000 }, rates, "openai/gpt-4");
    assert.equal(cost, null);
  });

  it("returns null when model is undefined", () => {
    const cost = computeCost({ input_tokens: 1000 }, rates, undefined);
    assert.equal(cost, null);
  });

  it("handles partial rate entry — missing output and cache rates default to 0", () => {
    const partialRates = { "deepseek/deepseek-v4-pro": { input_per_million: 0.14 } };
    const cost = computeCost(
      { input_tokens: 100000, output_tokens: 50000, cache_read_tokens: 20000 },
      partialRates,
      "deepseek/deepseek-v4-pro",
    );
    assert.ok(cost);
    assert.equal(cost!.input, 0.014);
    assert.equal(cost!.output, 0);
    assert.equal(cost!.cache_read, 0);
    assert.equal(cost!.total, 0.014);
  });

  it("returns all-zero breakdown when tokens are 0 (rates still present)", () => {
    const cost = computeCost(
      { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 },
      rates,
      "deepseek/deepseek-v4-pro",
    );
    assert.ok(cost);
    assert.equal(cost!.input, 0);
    assert.equal(cost!.output, 0);
    assert.equal(cost!.cache_read, 0);
    assert.equal(cost!.total, 0);
  });

  it("handles undefined token fields as 0", () => {
    const cost = computeCost({}, rates, "deepseek/deepseek-v4-pro");
    assert.ok(cost);
    assert.equal(cost!.total, 0);
  });
});
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build && node --test opencode-review/dist/ocr/compute-cost.test.js
```

Expected: all 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add opencode-review/src/ocr/compute-cost.test.ts opencode-review/dist/ocr/compute-cost.js opencode-review/dist/ocr/compute-cost.test.js
git commit -m "test: add computeCost unit tests"
```

---

## Task 3: Extend `append-measurement.ts` — add cost/elapsed/toolCalls

**Files:**
- Modify: `opencode-review/src/ocr/append-measurement.ts`

- [ ] **Step 1: Add the import for CostBreakdown type**

Add at the top of the file, after the existing interfaces:

```typescript
import type { CostBreakdown } from "./compute-cost.js";
```

- [ ] **Step 2: Extend `MeasurementRowInput` interface**

Replace the existing `MeasurementRowInput` interface (lines 6-13) with:

```typescript
interface MeasurementRowInput {
  verdict: string;
  findings: Finding[] | null | undefined;
  suppressed: number;
  tokens: Record<string, number>;
  prNumber: number;
  sha: string;
  cost: CostBreakdown | null;
  elapsedMs: number | null;
  toolCalls?: Record<string, number> | null;
}
```

- [ ] **Step 3: Extend `MeasurementRow` interface**

Replace the existing `MeasurementRow` interface (lines 24-33) with:

```typescript
interface MeasurementRow {
  lane: string;
  timestamp: string;
  pr: number;
  sha: string;
  context: { verdict: string };
  severity_tally: SeverityTally;
  suppressed_as_duplicate: number;
  tokens: Record<string, number | string>;
  cost: CostBreakdown | null;
  elapsed_ms: number | null;
  tool_calls: Record<string, number> | null;
}
```

- [ ] **Step 4: Extend `buildMeasurementRow` function**

Replace the function signature and return block (lines 35-52) with:

```typescript
export function buildMeasurementRow({ verdict, findings, suppressed, tokens, prNumber, sha, cost, elapsedMs, toolCalls }: MeasurementRowInput): MeasurementRow {
  const severityTally: SeverityTally = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
  for (const finding of (findings ?? [])) {
    const sev = finding.severity ?? "Info";
    if (severityTally[sev] !== undefined) severityTally[sev] += 1;
    else severityTally[sev] = 1;
  }

  return {
    lane: "ocr",
    timestamp: new Date().toISOString(),
    pr: prNumber,
    sha,
    context: { verdict },
    severity_tally: severityTally,
    suppressed_as_duplicate: suppressed ?? 0,
    tokens: { ...tokens, source: "ocr_native" },
    cost,
    elapsed_ms: elapsedMs,
    tool_calls: toolCalls ?? null,
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add opencode-review/src/ocr/append-measurement.ts
git commit -m "feat: extend buildMeasurementRow with cost, elapsed_ms, tool_calls fields"
```

---

## Task 4: Extend `append-measurement.test.ts` — new field tests

**Files:**
- Modify: `opencode-review/src/ocr/append-measurement.test.ts`

- [ ] **Step 1: Add new test cases**

Add these new `it` blocks inside the existing `describe("buildMeasurementRow", ...)` block, before the closing `});`:

```typescript
  it("includes cost breakdown when provided", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 1000 },
      prNumber: 1,
      sha: "abc",
      cost: { input: 0.01, output: 0.002, cache_read: 0.001, total: 0.013 },
      elapsedMs: 259647,
    });
    assert.deepEqual(row.cost, { input: 0.01, output: 0.002, cache_read: 0.001, total: 0.013 });
  });

  it("cost is null when not provided", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 1000 },
      prNumber: 1,
      sha: "abc",
      cost: null,
      elapsedMs: null,
    });
    assert.equal(row.cost, null);
  });

  it("elapsed_ms passes through correctly", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 1000 },
      prNumber: 1,
      sha: "abc",
      cost: null,
      elapsedMs: 259647,
    });
    assert.equal(row.elapsed_ms, 259647);
  });

  it("elapsed_ms is null when not provided", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 1000 },
      prNumber: 1,
      sha: "abc",
      cost: null,
      elapsedMs: null,
    });
    assert.equal(row.elapsed_ms, null);
  });

  it("tool_calls passes through when provided", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 1000 },
      prNumber: 1,
      sha: "abc",
      cost: null,
      elapsedMs: null,
      toolCalls: { file_read: 6, code_search: 1 },
    });
    assert.deepEqual(row.tool_calls, { file_read: 6, code_search: 1 });
  });

  it("tool_calls is null when not provided", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 1000 },
      prNumber: 1,
      sha: "abc",
      cost: null,
      elapsedMs: null,
    });
    assert.equal(row.tool_calls, null);
  });
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build && node --test opencode-review/dist/ocr/append-measurement.test.js
```

Expected: all tests PASS (original 4 + new 6 = 10).

- [ ] **Step 3: Commit**

```bash
git add opencode-review/src/ocr/append-measurement.test.ts opencode-review/dist/ocr/append-measurement.js opencode-review/dist/ocr/append-measurement.test.js
git commit -m "test: add cost, elapsed_ms, tool_calls tests to buildMeasurementRow"
```

---

## Task 5: Extend `post-findings.ts` — add measurement footer to verdict comment

**Files:**
- Modify: `opencode-review/src/ocr/post-findings.ts`

- [ ] **Step 1: Add import for CostBreakdown type**

At the top of `post-findings.ts`, after the existing interfaces, add:

```typescript
import type { CostBreakdown } from "./compute-cost.js";
```

- [ ] **Step 2: Define the MeasurementFooter interface**

Add after the `ManifestStatusInfo` interface (after line 140):

```typescript
interface ToolCallSummary {
  total?: number;
  by_tool?: Record<string, number>;
}

interface MeasurementFooter {
  tokens: { total?: number; input?: number; output?: number; cache_read?: number };
  cost: CostBreakdown | null;
  elapsedMs: number | null;
  toolCalls?: ToolCallSummary | null;
}
```

- [ ] **Step 3: Add `measurement` to `BuildVerdictInput`**

Replace the `BuildVerdictInput` interface (lines 142-150) with:

```typescript
interface BuildVerdictInput {
  findings: Finding[];
  headSha: string;
  verdictMarker: string;
  headMarker: string;
  serenaStatus?: string;
  manifestFallbackReason?: string;
  manifestStatus?: ManifestStatusInfo;
  measurement?: MeasurementFooter;
}
```

- [ ] **Step 4: Add `formatTokenCount` helper**

Add a new helper function before `buildVerdictComment` (before line 152):

```typescript
function formatTokenCount(n: number | undefined): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatElapsed(ms: number | null): string | null {
  if (ms == null) return null;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s}s`;
}

function buildFooter(measurement: MeasurementFooter): string {
  const parts: string[] = [];

  const totalTokens = measurement.tokens.total;
  const inputTokens = measurement.tokens.input;
  const outputTokens = measurement.tokens.output;
  const cacheTokens = measurement.tokens.cache_read;
  const hasTokens = (totalTokens ?? 0) > 0 || (inputTokens ?? 0) > 0 || (outputTokens ?? 0) > 0;

  if (hasTokens) {
    const tokenStr = formatTokenCount(totalTokens);
    const breakdown = `${formatTokenCount(inputTokens)} input \u00b7 ${formatTokenCount(outputTokens)} output${cacheTokens ? ` \u00b7 ${formatTokenCount(cacheTokens)} cache` : ""}`;
    parts.push(`${tokenStr} tokens (${breakdown})`);
  } else {
    parts.push("tokens unavailable");
  }

  const elapsed = formatElapsed(measurement.elapsedMs);
  if (elapsed) parts.push(elapsed);

  if (measurement.cost) {
    parts.push(`$${measurement.cost.total}`);
  }

  if (measurement.toolCalls) {
    const total = measurement.toolCalls.total;
    if (total != null && total > 0) {
      parts.push(`${total} tool calls`);
    }
  }

  return `\n---\n**Run:** ${parts.join(" \u00b7 ")}`;
}
```

- [ ] **Step 5: Update `buildVerdictComment` to accept `measurement` and render footer**

Change the function signature (line 152) to destructure `measurement`:

```typescript
export function buildVerdictComment({ findings, headSha, verdictMarker, headMarker, serenaStatus, manifestFallbackReason, manifestStatus, measurement }: BuildVerdictInput): string {
```

Then change the `return` statement (lines 181-192) to append the footer conditionally. Replace the existing return block with:

```typescript
  const footer = measurement ? buildFooter(measurement) : "";

  return `## Review Verdict

**Context:**
${contextLines.join("\n")}

**Verdict: ${verdict}** \u2014 ${total} finding${total !== 1 ? "s" : ""} (${criticalCount} CRITICAL, ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW)

${headMarker} ${headSha} -->
${verdictMarker}
<!-- findings-json-start
${JSON.stringify(items, null, 2)}
findings-json-end -->${footer}`;
```

- [ ] **Step 6: Commit**

```bash
git add opencode-review/src/ocr/post-findings.ts
git commit -m "feat: add measurement footer to buildVerdictComment (tokens, cost, elapsed)"
```

---

## Task 6: Extend `post-findings.test.ts` — footer tests

**Files:**
- Modify: `opencode-review/src/ocr/post-findings.test.ts`

- [ ] **Step 1: Add new test cases for the footer**

Add these new `it` blocks inside the existing `describe("buildVerdictComment", ...)` block (the one starting at line 161), before its closing `});`:

```typescript
  it("renders footer with cost when measurement provided", () => {
    const result = buildVerdictComment({
      findings: [],
      headSha: "abc123",
      verdictMarker: "<!-- opencode-pr-review -->",
      headMarker: "<!-- reviewed-head:",
      measurement: {
        tokens: { total: 188053, input: 177757, output: 10296, cache_read: 126592 },
        cost: { input: 0.0249, output: 0.0029, cache_read: 0.0018, total: 0.0296 },
        elapsedMs: 259647,
        toolCalls: { total: 11 },
      },
    });
    assert.match(result, /\*\*Run:\*\*/);
    assert.match(result, /188K tokens/);
    assert.match(result, /178K input/);
    assert.match(result, /\$0\.0296/);
    assert.match(result, /4m20s/);
    assert.match(result, /11 tool calls/);
  });

  it("renders footer without cost when cost is null", () => {
    const result = buildVerdictComment({
      findings: [],
      headSha: "abc123",
      verdictMarker: "<!-- opencode-pr-review -->",
      headMarker: "<!-- reviewed-head:",
      measurement: {
        tokens: { total: 5000, input: 4000, output: 1000 },
        cost: null,
        elapsedMs: 60000,
      },
    });
    assert.match(result, /\*\*Run:\*\*/);
    assert.match(result, /5K tokens/);
    assert.match(result, /1m0s/);
    assert.doesNotMatch(result, /\$/);
  });

  it("renders 'tokens unavailable' when summary is empty", () => {
    const result = buildVerdictComment({
      findings: [],
      headSha: "abc123",
      verdictMarker: "<!-- opencode-pr-review -->",
      headMarker: "<!-- reviewed-head:",
      measurement: {
        tokens: {},
        cost: null,
        elapsedMs: null,
      },
    });
    assert.match(result, /tokens unavailable/);
    assert.doesNotMatch(result, /\$/);
    assert.doesNotMatch(result, /tool calls/);
  });

  it("omits footer entirely when measurement not passed (backward-compat)", () => {
    const result = buildVerdictComment({
      findings: [],
      headSha: "abc123",
      verdictMarker: "<!-- opencode-pr-review -->",
      headMarker: "<!-- reviewed-head:",
    });
    assert.doesNotMatch(result, /\*\*Run:\*\*/);
    assert.doesNotMatch(result, /tokens/);
  });
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build && node --test opencode-review/dist/ocr/post-findings.test.js
```

Expected: all tests PASS (original + new 4 footer tests).

- [ ] **Step 3: Commit**

```bash
git add opencode-review/src/ocr/post-findings.test.ts opencode-review/dist/ocr/post-findings.js opencode-review/dist/ocr/post-findings.test.js
git commit -m "test: add measurement footer tests to buildVerdictComment"
```

---

## Task 7: Add `ocr_cost_rates` input to `action.yml`

**Files:**
- Modify: `opencode-review/action.yml` (after line 87, the `org_profiles` input)

- [ ] **Step 1: Add the new input**

Insert after the `org_profiles` input block (after line 87, before the `runs:` section at line 89):

```yaml
  ocr_cost_rates:
    description: >-
      Optional JSON mapping model IDs to per-million-token rates.
      Example: {"deepseek/deepseek-v4-pro":{"input_per_million":0.14,"output_per_million":0.28,"cache_read_per_million":0.014}}
      When omitted, tokens and elapsed are shown but no dollar cost.
    required: false
    default: ""
```

- [ ] **Step 2: Commit**

```bash
git add opencode-review/action.yml
git commit -m "feat: add ocr_cost_rates action input for optional cost tracking"
```

---

## Task 8: Wire cost tracking into "Post review findings" step

**Files:**
- Modify: `opencode-review/action.yml` — the "Post review findings" step (lines 627-736)

This is the core wiring task. Three sub-changes in the same step:

### 8a: Defensive JSON parsing + full summary extraction

- [ ] **Step 1: Replace the findings parsing (line 644-645)**

Replace:
```javascript
          const rawFindings = JSON.parse(fs.readFileSync('/tmp/findings.json', 'utf8'));
          const findings = Array.isArray(rawFindings) ? rawFindings : (rawFindings.comments || []);
```

With:
```javascript
          const rawText = fs.readFileSync('/tmp/findings.json', 'utf8');
          const jsonStart = rawText.indexOf('{');
          const jsonEnd = rawText.lastIndexOf('}');
          const rawFindings = jsonStart >= 0 ? JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)) : {};
          const findings = Array.isArray(rawFindings) ? rawFindings : (rawFindings.comments || []);

          const summary = rawFindings.summary || {};
          const manifest = rawFindings.manifest || {};
          const llmModel = rawFindings.llm?.model || manifest?.execution?.model || '';
          const ocrTokens = {
            total: summary.total_tokens || 0,
            input: summary.input_tokens || 0,
            output: summary.output_tokens || 0,
            cache_read: summary.cache_read_tokens || 0,
          };
```

### 8b: Compute cost + build measurement row after computeFindings

- [ ] **Step 2: Add cost + measurement logic after `computeFindings` (after line 659)**

After the line `const result = computeFindings({ findings, anchors, diffLines });` (line 659), insert:

```javascript

          // Parse optional rate table for cost computation
          let rates = null;
          const ratesInput = '\${{ inputs.ocr_cost_rates }}';
          if (ratesInput) {
            try { rates = JSON.parse(ratesInput); } catch { core.warning('ocr_cost_rates is not valid JSON - cost will be omitted'); }
          }

          const { computeCost } = await import('\${{ github.action_path }}/dist/ocr/compute-cost.js');
          const cost = computeCost(
            { input_tokens: ocrTokens.input, output_tokens: ocrTokens.output, cache_read_tokens: ocrTokens.cache_read },
            rates,
            llmModel,
          );

          const { buildMeasurementRow } = await import('\${{ github.action_path }}/dist/ocr/append-measurement.js');
          const toolCallsByTool = rawFindings.tool_calls?.by_tool || null;
          const measurementRow = buildMeasurementRow({
            verdict: result.kept.length > 0 ? 'FAIL' : 'PASS',
            findings: result.kept,
            suppressed: result.dropped.length,
            tokens: ocrTokens,
            prNumber,
            sha: headSha,
            cost,
            elapsedMs: manifest?.elapsed_ms || null,
            toolCalls: toolCallsByTool,
          });
```

### 8c: Pass measurement into buildVerdictComment + write enriched ocr-result.json

- [ ] **Step 3: Update the buildVerdictComment call (lines 721-728)**

Replace:
```javascript
          const verdictBody = buildVerdictComment({
            findings: result.kept,
            headSha,
            verdictMarker: '\${{ inputs.verdict_marker }}',
            headMarker: '\${{ inputs.head_marker }}',
            serenaStatus,
            manifestStatus,
          });
```

With:
```javascript
          const verdictBody = buildVerdictComment({
            findings: result.kept,
            headSha,
            verdictMarker: '\${{ inputs.verdict_marker }}',
            headMarker: '\${{ inputs.head_marker }}',
            serenaStatus,
            manifestStatus,
            measurement: {
              tokens: ocrTokens,
              cost,
              elapsedMs: manifest?.elapsed_ms || null,
              toolCalls: rawFindings.tool_calls,
            },
          });
```

- [ ] **Step 4: Replace the ocr-result.json write (line 736)**

Replace:
```javascript
          fs.writeFileSync('/tmp/ocr-result.json', JSON.stringify({ kept: result.kept.length, dropped: result.dropped.length, resolved: result.resolved.length, snapped: result.snappedCount }));
```

With:
```javascript
          fs.writeFileSync('/tmp/ocr-result.json', JSON.stringify({
            kept: result.kept.length,
            dropped: result.dropped.length,
            resolved: result.resolved.length,
            snapped: result.snappedCount,
            measurement: measurementRow,
          }));
```

- [ ] **Step 5: Commit**

```bash
git add opencode-review/action.yml
git commit -m "feat: wire cost tracking into Post review findings step"
```

---

## Task 9: Simplify "Emit review telemetry" step to consume enriched data

**Files:**
- Modify: `opencode-review/action.yml` — the "Emit review telemetry" step (lines 738-774)

- [ ] **Step 1: Replace the inline node script (lines 752-773)**

Replace the entire `node -e "..."` block with:

```javascript
        node -e "
          const fs = require('fs');
          let ocrResult = {};
          try { ocrResult = JSON.parse(fs.readFileSync('/tmp/ocr-result.json', 'utf8')); } catch {}
          const measurement = ocrResult.measurement || {};

          const row = {
            pr: Number(process.env.PR_NUMBER),
            run_id: process.env.RUN_ID,
            engine: process.env.ENGINE || 'ocr',
            mode: process.env.MODE || null,
            base_sha: process.env.BASE_SHA || null,
            head_sha: process.env.HEAD_SHA || null,
            serena: { status: process.env.SERENA_STATUS || 'disabled' },
            model: 'deepseek/deepseek-v4-pro',
            timestamp: measurement.timestamp || new Date().toISOString(),
            verdict: (ocrResult.kept || 0) > 0 ? 'FAIL' : 'PASS',
            findings: {
              kept: ocrResult.kept || 0,
              dropped: ocrResult.dropped || 0,
              resolved: ocrResult.resolved || 0,
              snapped: ocrResult.snapped || 0,
            },
            severity_tally: measurement.severity_tally || null,
            suppressed_as_duplicate: measurement.suppressed_as_duplicate || 0,
            tokens: measurement.tokens || null,
            cost: measurement.cost || null,
            elapsed_ms: measurement.elapsed_ms || null,
            tool_calls: measurement.tool_calls || null,
          };
          fs.writeFileSync(process.env.RUNNER_TEMP + '/telemetry/review-run.json', JSON.stringify(row, null, 2) + '\n');
        "
```

- [ ] **Step 2: Commit**

```bash
git add opencode-review/action.yml
git commit -m "feat: enrich telemetry artifact with measurement data from ocr-result.json"
```

---

## Task 10: Build, typecheck, test, verify dist sync

**Files:**
- All `opencode-review/src/` and `opencode-review/dist/`

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: compiles without errors.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all test files pass (compute-cost, append-measurement, post-findings, plus all existing tests).

- [ ] **Step 4: Verify dist is in sync**

```bash
npm run check-dist
```

Expected: no diff (exit code 0).

- [ ] **Step 5: Commit any remaining dist changes**

```bash
git add opencode-review/dist/
git commit -m "build: recompile dist for cost-per-run tracking" || echo "No dist changes to commit"
```

---

## Task 11: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add documentation for cost tracking**

In the "Review context (v4)" section, after the OCR engine subsection (after line 111), add:

```markdown
### Cost tracking

The OCR CLI emits token usage and timing data on every run. The toolkit captures
this and surfaces it in two places:

1. **Verdict comment footer** — every review comment ends with a `**Run:**` line
   showing token counts, elapsed time, and (if rates are configured) dollar cost.

2. **Telemetry artifact** — the `review-telemetry-<run_id>` artifact includes the
   full measurement row: `tokens`, `cost`, `elapsed_ms`, `severity_tally`,
   `tool_calls`, and `suppressed_as_duplicate`.

Dollar cost is **opt-in**. Provide the `ocr_cost_rates` input as a JSON object
mapping model IDs to per-million-token rates:

```yaml
- uses: elbertcl/code-review-toolkit/opencode-review@v4
  with:
    ocr_llm_url: ${{ secrets.OCR_POC_LLM_URL }}
    ocr_llm_token: ${{ secrets.OCR_POC_LLM_TOKEN }}
    ocr_cost_rates: '{"deepseek/deepseek-v4-pro":{"input_per_million":0.14,"output_per_million":0.28,"cache_read_per_million":0.014}}'
```

When omitted, the footer shows tokens and elapsed time only — no dollar amount.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document cost tracking feature (ocr_cost_rates input, verdict footer, telemetry)"
```

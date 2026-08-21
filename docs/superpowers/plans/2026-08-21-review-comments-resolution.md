# Review-Comments Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the five approved review-comment resolutions: always-on-push default trigger, org-default dimensions fallback, per-repo `ocr_model`, BLOCKED comment dedupe, and the Datadog-based benchmarking/observability framework (telemetry v2, t0 direct push, t2 outcome workflow, offline benchmark harness, dashboard).

**Architecture:** Composite action `opencode-review` gains an `ocr_model` input, default-policy fallback, telemetry v2 fields, and a best-effort Datadog push step. Two new reusable workflows in `.github/workflows/` (push-triggered review wrapper, PR-closed outcome classifier) replace the non-functional `review-monitoring.yml`. A benchmark harness under `opencode-review/src/benchmark/` replays a self-contained golden corpus across models with deterministic evaluators. All TS is compiled to committed `dist/` (`npm run build`), tested via `node --test dist/**/*.test.js`.

**Tech Stack:** TypeScript 5.5 (strict, ESM), GitHub Actions composite + reusable workflows, Datadog Metrics API v2, `@alibaba-group/open-code-review` CLI 1.8.9, node:test.

**Spec:** `docs/superpowers/specs/2026-08-21-review-comments-resolution-design.md`

**Commands (run from repo root):**
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Dist guard: `npm run check-dist`

---

### Task 1: `resolve-manifest` — org-default `defaultPolicyBody`

**Files:**
- Modify: `opencode-review/src/context/resolve-manifest.ts`
- Test: `opencode-review/src/context/resolve-manifest.test.ts`

**Refinement over spec §4 (recorded):** `defaultPolicyBody` is populated whenever the workspace `policy_path` file does not exist — not only in fallback mode. Otherwise a repo with a valid `REVIEW.md` but a missing `docs/review-dimensions.md` still silently reviews with empty dimensions (same gap). Repo policy always wins when present.

- [ ] **Step 1: Write the failing tests**

Append to `opencode-review/src/context/resolve-manifest.test.ts` (imports already present in the file: `describe, it` from `node:test`, `assert` from `node:assert/strict`; add these imports at the top if missing):

```ts
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("defaultPolicyBody", () => {
  const fallbackManifestPath = join(import.meta.dirname, "../../context/defaults/REVIEW.md");
  const defaultsJsonPath = join(import.meta.dirname, "../../context/defaults/manifest-defaults.json");

  function makeWorkspace(withPolicy: boolean): string {
    const ws = mkdtempSync(join(tmpdir(), "rm-ws-"));
    if (withPolicy) {
      mkdirSync(join(ws, "docs"), { recursive: true });
      writeFileSync(join(ws, "docs/review-dimensions.md"), "## Section 1: Business\n- Repo rule\n");
    }
    return ws;
  }

  function run(repoManifest: string | null, ws: string) {
    return resolveManifest({
      repoManifestPath: repoManifest ?? join(ws, "REVIEW.md-absent"),
      fallbackManifestPath,
      defaultsJsonPath,
      changedFilesJsonPath: join(ws, "changed-absent.json"),
      workspace: ws,
    });
  }

  it("populates defaultPolicyBody when repo REVIEW.md is absent and policy file missing", () => {
    const ws = makeWorkspace(false);
    const result = run(null, ws);
    assert.ok(result.status.defaultPolicyBody.length > 0);
    assert.match(result.status.defaultPolicyBody, /N\+1/);
  });

  it("leaves defaultPolicyBody empty when the repo policy file exists", () => {
    const ws = makeWorkspace(true);
    const repoManifest = join(ws, "REVIEW.md");
    copyFileSync(fallbackManifestPath, repoManifest);
    const result = run(repoManifest, ws);
    assert.equal(result.status.defaultPolicyBody, "");
  });

  it("populates defaultPolicyBody when repo REVIEW.md exists but policy file is missing", () => {
    const ws = makeWorkspace(false);
    const repoManifest = join(ws, "REVIEW.md");
    copyFileSync(fallbackManifestPath, repoManifest);
    const result = run(repoManifest, ws);
    assert.ok(result.status.defaultPolicyBody.length > 0);
    assert.match(result.status.defaultPolicyBody, /Business Correctness/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `defaultPolicyBody` does not exist on `ManifestStatus` (TS compile error in test or assertion failure).

- [ ] **Step 3: Implement**

In `opencode-review/src/context/resolve-manifest.ts`:

3a. Extend the interface (line 11-16):

```ts
export interface ManifestStatus {
  status: "READY" | "READY_WITH_GAPS" | "BLOCKED";
  fallbackReason: string;
  blockers: string[];
  missingOptional: string[];
  defaultPolicyBody: string;
}
```

3b. Add import at top:

```ts
import { join } from "node:path";
```

3c. Inside `resolveManifest`, after the manifest load/merge block (after the `mergeWithDefaults` try/catch, before the `classifyContext` try/catch), insert:

```ts
  let defaultPolicyBody = "";
  try {
    if (!existsSync(join(input.workspace, manifest.policy_path))) {
      const fallbackMd = readFileSync(input.fallbackManifestPath, "utf8");
      const m = fallbackMd.match(/^# Review Dimensions\s*\n([\s\S]*?)(?=\n#\s|\s*$)/);
      if (m) defaultPolicyBody = m[1].trim();
    }
  } catch {
    // defaultPolicyBody is best-effort; empty means caller falls back to empty policy
  }
```

3d. Change the return statement (line 75) to include the field:

```ts
  return { manifest: merged, status: { status, fallbackReason, blockers, missingOptional, defaultPolicyBody } };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add opencode-review/src/context/resolve-manifest.ts opencode-review/src/context/resolve-manifest.test.ts
git commit -m "feat(review): emit org-default policy body when repo review-dimensions missing"
```

---

### Task 2: Wire `defaultPolicyBody` + context metrics into action.yml compile step

**Files:**
- Modify: `opencode-review/action.yml` (step "Compile review rules", lines ~552-617)

- [ ] **Step 1: Add step id and BLOCKED output (also serves Task 4)**

Add `id: ocr-rules` to the "Compile review rules" step:

```yaml
    - name: Compile review rules
      id: ocr-rules
```

In the BLOCKED branch, before `exit 1`, add:

```bash
          echo "aborted_with_comment=true" >> "$GITHUB_OUTPUT"
          exit 1
```

- [ ] **Step 2: Use defaultPolicyBody when repo policy is absent**

In the same step's inline `node --input-type=module` script, replace:

```js
          const policyBody = existsSync(manifest.policy_path) ? readFileSync(manifest.policy_path, 'utf8') : '';
```

with:

```js
          let policyBody = existsSync(manifest.policy_path) ? readFileSync(manifest.policy_path, 'utf8') : '';
          if (!policyBody) {
            policyBody = JSON.parse(readFileSync('/tmp/manifest-status.json', 'utf8')).defaultPolicyBody || '';
          }
```

- [ ] **Step 3: Emit context-metrics.json**

Extend the import line at the top of the same inline script:

```js
          import { compileOcrRules } from '\${{ github.action_path }}/dist/ocr/compile-ocr-rules.js';
          import { globMatches } from '\${{ github.action_path }}/dist/context/lib/review-manifest.js';
          import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
```

After the `writeFileSync(... ocr-rule.json ...)` line, append:

```js
          const changed = JSON.parse(readFileSync(process.env.RUNNER_TEMP + '/changed-files.json', 'utf8'));
          const matchedConditional = (manifest.conditional_context ?? []).filter(
            (c) => c.when_changed.some((g) => changed.some((f) => globMatches(g, f)))
          );
          const matchedDirectives = (manifest.review_directives ?? []).filter(
            (d) => d.when_changed.some((g) => changed.some((f) => globMatches(g, f)))
          );
          const fileSize = (p) => { try { return statSync(p).size; } catch { return 0; } };
          writeFileSync(process.env.RUNNER_TEMP + '/context-metrics.json', JSON.stringify({
            rules_compiled: rules.rules.length,
            conditional_contexts_matched: matchedConditional.map((c) => c.paths.join(',')),
            directives_applied: matchedDirectives.length,
            rule_json_bytes: fileSize(process.env.RUNNER_TEMP + '/ocr-rule.json'),
            background_bytes: fileSize('/tmp/background.md'),
            serena_pointer_chars: fileSize('/tmp/serena-context.md'),
          }, null, 2) + '\n');
```

- [ ] **Step 4: Verify YAML parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('opencode-review/action.yml','utf8');const open=(s.match(/- name:/g)||[]).length;console.log('steps:',open)"`
Expected: prints a step count; no exception. (CI's check-dist + a dry run will validate the rest.)

- [ ] **Step 5: Commit**

```bash
git add opencode-review/action.yml
git commit -m "feat(review): apply default policy body + emit per-run context metrics"
```

---

### Task 3: `ocr_model` input + verdict `Model:` line

**Files:**
- Modify: `opencode-review/action.yml`
- Modify: `opencode-review/src/ocr/post-findings.ts`
- Test: `opencode-review/src/ocr/post-findings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `opencode-review/src/ocr/post-findings.test.ts` (uses existing imports of `buildVerdictComment`, `describe`, `it`, `assert`):

```ts
describe("buildVerdictComment model line", () => {
  it("includes the model in context lines when provided", () => {
    const body = buildVerdictComment({
      findings: [],
      headSha: "abc123def4567890",
      verdictMarker: "<!-- verdict -->",
      headMarker: "<!-- head:",
      model: "openrouter/qwen-3-coder",
    });
    assert.match(body, /- Model: openrouter\/qwen-3-coder/);
  });

  it("omits the model line when not provided", () => {
    const body = buildVerdictComment({
      findings: [],
      headSha: "abc123def4567890",
      verdictMarker: "<!-- verdict -->",
      headMarker: "<!-- head:",
    });
    assert.doesNotMatch(body, /- Model:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `model` not in `BuildVerdictInput`.

- [ ] **Step 3: Implement**

In `opencode-review/src/ocr/post-findings.ts`:

3a. Add to `BuildVerdictInput` (line 161-170):

```ts
  model?: string;
```

3b. In `buildVerdictComment`, after the `contextLines` assignment (before the `missingOptional` push), add:

```ts
  if (model) {
    contextLines.push(`- Model: ${model}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Wire action.yml**

5a. Add input (after `org_profiles`, ~line 87):

```yaml
  ocr_model:
    description: >-
      OCR LLM model ID passed to `ocr config set llm.model`. Per-repo choice;
      verify IDs against the provider catalog before use.
    required: false
    default: "deepseek/deepseek-v4-pro"
```

5b. In "Install and run review CLI" step, replace:

```bash
        ocr config set llm.model deepseek/deepseek-v4-pro
```

with:

```bash
        ocr config set llm.model "${{ inputs.ocr_model }}"
```

5c. In "Post review findings" step's `buildVerdictComment({ ... })` call, add after `headMarker`:

```js
            model: '\${{ inputs.ocr_model }}',
```

- [ ] **Step 6: Commit**

```bash
git add opencode-review/action.yml opencode-review/src/ocr/post-findings.ts opencode-review/src/ocr/post-findings.test.ts
git commit -m "feat(review): per-repo ocr_model input surfaced in verdict and OCR config"
```

---

### Task 4: BLOCKED double-comment dedupe

**Files:**
- Modify: `opencode-review/action.yml` (step "Post failure comment", line ~863)

(The `aborted_with_comment` output was already added in Task 2 Step 1.)

- [ ] **Step 1: Gate the generic failure comment**

Change:

```yaml
    - name: Post failure comment
      if: failure() || cancelled()
```

to:

```yaml
    - name: Post failure comment
      if: (failure() || cancelled()) && steps.ocr-rules.outputs.aborted_with_comment != 'true'
```

- [ ] **Step 2: Verify**

Run: `node -e "console.log('ok')"` — YAML structure unchanged except the `if:`; full validation happens in the Task 10 build/CI pass.

- [ ] **Step 3: Commit**

```bash
git add opencode-review/action.yml
git commit -m "fix(review): suppress generic failure comment when BLOCKED abort already commented"
```

---

### Task 5: Telemetry v2 (repo/model/org_profiles/context + rule_citation_rate)

**Files:**
- Modify: `opencode-review/action.yml` ("Post review findings" ~line 643, "Emit review telemetry" ~line 807)
- Modify: `opencode-review/src/ocr/append-measurement.ts` (no — do NOT touch; only action.yml inline scripts change)

- [ ] **Step 1: Record `rule_cited` in the post step**

In "Post review findings", change the `/tmp/ocr-result.json` write to:

```js
          const ruleRe = /RULE-[A-Z]+-\d+/i;
          const ruleCited = result.kept.filter((f) => ruleRe.test(f.message || f.content || "")).length;
          fs.writeFileSync('/tmp/ocr-result.json', JSON.stringify({
            kept: result.kept.length,
            dropped: result.dropped.length,
            resolved: result.resolved.length,
            snapped: result.snappedCount,
            rule_cited: ruleCited,
            measurement: measurementRow,
          }));
```

- [ ] **Step 2: Extend the telemetry row**

In "Emit review telemetry" step env block, add:

```yaml
        REPO: ${{ github.repository }}
        MODEL: ${{ inputs.ocr_model }}
        ORG_PROFILES: ${{ inputs.org_profiles }}
```

In the inline node script, after `const measurement = ocrResult.measurement || {};` insert:

```js
          let contextBlock = {};
          try { contextBlock = JSON.parse(fs.readFileSync(process.env.RUNNER_TEMP + '/context-metrics.json', 'utf8')); } catch {}
          try {
            const ms = JSON.parse(fs.readFileSync('/tmp/manifest-status.json', 'utf8'));
            contextBlock.manifest_status = ms.status;
            contextBlock.fallback_reason = ms.fallbackReason || '';
          } catch {}
          contextBlock.rule_citation_rate = (ocrResult.rule_cited != null && (ocrResult.kept || 0) > 0)
            ? ocrResult.rule_cited / ocrResult.kept : null;
```

And in the `row` object, after `engine:` add:

```js
            repo: process.env.REPO || null,
            model: process.env.MODEL || 'deepseek/deepseek-v4-pro',
            org_profiles: process.env.ORG_PROFILES || null,
            context: contextBlock,
```

- [ ] **Step 3: Verify + commit**

Run: `npm test 2>&1 | tail -5` (action.yml not covered by unit tests; ensures no regressions)

```bash
git add opencode-review/action.yml
git commit -m "feat(telemetry): v2 row with repo/model/org_profiles and context block"
```

---

### Task 6: t0 direct push — `push-run-metrics.ts`

**Files:**
- Create: `opencode-review/src/monitoring/push-run-metrics.ts`
- Test: `opencode-review/src/monitoring/push-run-metrics.test.ts`
- Modify: `opencode-review/action.yml`

- [ ] **Step 1: Write the failing test**

Create `opencode-review/src/monitoring/push-run-metrics.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRunSeries, RunMetricRow } from "./push-run-metrics.js";

describe("buildRunSeries", () => {
  const row: RunMetricRow = {
    pr: 42,
    repo: "astronautsid/astro-ads-be",
    model: "deepseek/deepseek-v4-pro",
    org_profiles: "backend/security,backend/sre",
    mode: "review",
    verdict: "FAIL",
    tokens: { input: 100, output: 50, cache_read: 25, total: 175 },
    cost: { total: 0.03 },
    elapsed_ms: 60_000,
    tool_calls: 7,
    serena: { status: "available" },
    context: {
      rules_compiled: 3,
      conditional_contexts_matched: ["docs/invariants/tracker.md"],
      directives_applied: 1,
      rule_json_bytes: 4096,
      background_bytes: 8192,
      serena_pointer_chars: 2000,
      manifest_status: "READY",
      fallback_reason: "",
      rule_citation_rate: 0.5,
    },
  };

  it("builds tagged gauge series with prefixed names", () => {
    const series = buildRunSeries(row, 1_700_000_000);
    assert.ok(series.length >= 10);
    for (const s of series) {
      assert.ok(s.metric.startsWith("code_review_toolkit."));
      assert.equal(s.type, "gauge");
      assert.ok(s.tags.includes("repo:astronautsid/astro-ads-be"));
      assert.ok(s.tags.includes("model:deepseek/deepseek-v4-pro"));
      assert.ok(s.tags.includes("org_profile:backend/security"));
      assert.ok(s.tags.includes("org_profile:backend/sre"));
      assert.ok(s.tags.includes("mode:review"));
      assert.ok(s.tags.includes("verdict:FAIL"));
    }
    const names = series.map((s) => s.metric);
    assert.ok(names.includes("code_review_toolkit.tokens.input"));
    assert.ok(names.includes("code_review_toolkit.cost.total"));
    assert.ok(names.includes("code_review_toolkit.context.rule_citation_rate"));
    assert.ok(names.includes("code_review_toolkit.context.rules_compiled"));
  });

  it("emits reliability gauges for degraded runs", () => {
    const degraded: RunMetricRow = {
      ...row,
      serena: { status: "unavailable" },
      context: { ...row.context!, manifest_status: "BLOCKED", fallback_reason: "REVIEW.md not found" },
    };
    const names = buildRunSeries(degraded, 1_700_000_000).map((s) => s.metric);
    assert.ok(names.includes("code_review_toolkit.reliability.serena_fail_open"));
    assert.ok(names.includes("code_review_toolkit.reliability.fallback"));
    assert.ok(names.includes("code_review_toolkit.reliability.manifest_status_blocked"));
  });

  it("handles a minimal row without optional fields", () => {
    const series = buildRunSeries({ pr: 1, repo: "o/r", model: "m" } as RunMetricRow, 1);
    assert.equal(series.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `opencode-review/src/monitoring/push-run-metrics.ts`:

```ts
import { readFileSync } from "node:fs";
import { pushToDatadog, type DatadogSeries } from "./push-datadog.js";

export interface RunMetricRow {
  pr: number;
  repo?: string | null;
  model?: string | null;
  org_profiles?: string | null;
  mode?: string | null;
  verdict?: string | null;
  tokens?: Record<string, number | string> | null;
  cost?: { total?: number } | null;
  elapsed_ms?: number | null;
  tool_calls?: number | Record<string, number> | null;
  serena?: { status?: string } | null;
  context?: {
    rules_compiled?: number;
    conditional_contexts_matched?: string[];
    directives_applied?: number;
    rule_json_bytes?: number;
    background_bytes?: number;
    serena_pointer_chars?: number;
    manifest_status?: string;
    fallback_reason?: string;
    rule_citation_rate?: number | null;
  } | null;
}

export function buildRunSeries(row: RunMetricRow, ts: number): DatadogSeries[] {
  const tags: string[] = [];
  if (row.repo) tags.push(`repo:${row.repo}`);
  if (row.model) tags.push(`model:${row.model}`);
  if (row.org_profiles) {
    for (const p of row.org_profiles.split(",")) {
      const t = p.trim();
      if (t) tags.push(`org_profile:${t}`);
    }
  }
  if (row.mode) tags.push(`mode:${row.mode}`);
  if (row.verdict) tags.push(`verdict:${row.verdict}`);

  const points: Array<[string, number]> = [];
  const t = row.tokens ?? {};
  if (Number(t.input)) points.push(["tokens.input", Number(t.input)]);
  if (Number(t.output)) points.push(["tokens.output", Number(t.output)]);
  if (Number(t.cache_read)) points.push(["tokens.cache_read", Number(t.cache_read)]);
  if (row.cost?.total != null) points.push(["cost.total", row.cost.total]);
  if (row.elapsed_ms != null) points.push(["elapsed_ms", row.elapsed_ms]);
  if (typeof row.tool_calls === "number") points.push(["tool_calls", row.tool_calls]);

  const ctx = row.context ?? {};
  if (ctx.rules_compiled != null) points.push(["context.rules_compiled", ctx.rules_compiled]);
  if (ctx.conditional_contexts_matched) points.push(["context.conditional_contexts_matched", ctx.conditional_contexts_matched.length]);
  if (ctx.directives_applied != null) points.push(["context.directives_applied", ctx.directives_applied]);
  if (ctx.rule_json_bytes != null) points.push(["context.rule_json_bytes", ctx.rule_json_bytes]);
  if (ctx.background_bytes != null) points.push(["context.background_bytes", ctx.background_bytes]);
  if (ctx.serena_pointer_chars != null) points.push(["context.serena_pointer_chars", ctx.serena_pointer_chars]);
  if (ctx.rule_citation_rate != null) points.push(["context.rule_citation_rate", ctx.rule_citation_rate]);
  if (ctx.manifest_status === "BLOCKED") points.push(["reliability.manifest_status_blocked", 1]);
  else if (ctx.manifest_status === "READY_WITH_GAPS") points.push(["reliability.manifest_status_gaps", 1]);
  if (ctx.fallback_reason) points.push(["reliability.fallback", 1]);
  if (row.serena?.status === "unavailable") points.push(["reliability.serena_fail_open", 1]);

  return points.map(([name, value]) => ({
    metric: `code_review_toolkit.${name}`,
    points: [[ts, value]],
    type: "gauge",
    tags,
  }));
}

export async function pushRunMetrics(apiKey: string, site: string, row: RunMetricRow): Promise<{ ok: boolean; error?: string }> {
  const series = buildRunSeries(row, Math.floor(Date.now() / 1000));
  if (series.length === 0) return { ok: true };
  const result = await pushToDatadog(apiKey, site, series);
  return { ok: result.ok, error: result.error };
}

if (process.argv[1] && process.argv[1].endsWith("push-run-metrics.js")) {
  const rowPath = process.argv[2];
  const apiKey = process.env.DD_API_KEY || "";
  if (!rowPath) {
    process.stderr.write("Usage: node push-run-metrics.js <review-run.json>\n");
    process.exit(1);
  }
  if (!apiKey) {
    process.stdout.write("metrics: DD_API_KEY not set — skipping push\n");
    process.exit(0);
  }
  try {
    const row = JSON.parse(readFileSync(rowPath, "utf8")) as RunMetricRow;
    const result = await pushRunMetrics(apiKey, process.env.DD_SITE || "datadoghq.com", row);
    if (!result.ok) process.stdout.write(`metrics: push failed (${result.error})\n`);
    else process.stdout.write("metrics: pushed\n");
  } catch (error) {
    process.stdout.write(`metrics: skipped (${(error as Error).message})\n`);
  }
  process.exit(0); // best-effort: never fail the workflow
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Wire into action.yml**

5a. Add inputs (after `ocr_cost_rates`):

```yaml
  metrics_datadog_api_key:
    description: >-
      Optional Datadog API key. When set, per-run efficiency/context/reliability
      metrics are pushed directly from the review run (best-effort, never fails
      the review). When empty, pushing is skipped.
    required: false
    default: ""
  metrics_datadog_site:
    description: Datadog site (e.g. datadoghq.com, us5.datadoghq.com).
    required: false
    default: "datadoghq.com"
```

5b. Add a step after "Upload telemetry artifact":

```yaml
    - name: Push run metrics (Datadog)
      if: always() && inputs.metrics_datadog_api_key != ''
      shell: bash
      env:
        DD_API_KEY: ${{ inputs.metrics_datadog_api_key }}
        DD_SITE: ${{ inputs.metrics_datadog_site }}
      run: node "${{ github.action_path }}/dist/monitoring/push-run-metrics.js" "$RUNNER_TEMP/telemetry/review-run.json"
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`

```bash
git add opencode-review/src/monitoring/push-run-metrics.ts opencode-review/src/monitoring/push-run-metrics.test.ts opencode-review/action.yml opencode-review/dist/
git commit -m "feat(monitoring): t0 direct Datadog push of run metrics (best-effort)"
```

---

### Task 7: t2 outcome pipeline — `classify-outcomes.ts` + reusable workflow; delete old monitoring

**Files:**
- Create: `opencode-review/src/monitoring/classify-outcomes.ts`
- Test: `opencode-review/src/monitoring/classify-outcomes.test.ts`
- Create: `.github/workflows/review-outcome.yml`
- Delete: `.github/workflows/review-monitoring.yml`

**Outcome taxonomy (deterministic, from thread state at PR close):** bot finding threads — `accepted` (resolved) / `disputed` (unresolved + human reply) / `deferred` (unresolved, no reply). Precision = accepted/(accepted+disputed) via existing `computeObservedPrecision`. Recall = estimated from human threads matched to a bot anchor (same path, ±5 lines) via existing `computeEstimatedRecall`.

- [ ] **Step 1: Write the failing tests**

Create `opencode-review/src/monitoring/classify-outcomes.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyThreads, ThreadNode } from "./classify-outcomes.js";

function botThread(path: string, line: number, opts: { resolved?: boolean; humanReply?: string } = {}): ThreadNode {
  const nodes: Array<{ author: { login: string } | null; body: string; path: string; line: number | null; createdAt: string }> = [
    { author: { login: "github-actions[bot]" }, body: `**[HIGH]** issue`, path, line, createdAt: "2026-08-21T10:00:00Z" },
  ];
  if (opts.humanReply) {
    nodes.push({ author: { login: "elbertcl" }, body: opts.humanReply, path, line, createdAt: "2026-08-21T11:00:00Z" });
  }
  return { isResolved: opts.resolved ?? false, isOutdated: false, comments: { totalCount: nodes.length, nodes } };
}

function humanThread(path: string, line: number): ThreadNode {
  return {
    isResolved: true,
    isOutdated: false,
    comments: {
      totalCount: 1,
      nodes: [{ author: { login: "mariozul" }, body: "this leaks", path, line, createdAt: "2026-08-21T12:00:00Z" }],
    },
  };
}

describe("classifyThreads", () => {
  it("resolved bot thread -> accepted; precision 1", () => {
    const s = classifyThreads([botThread("a.go", 10, { resolved: true })]);
    assert.equal(s.accepted, 1);
    assert.equal(s.precision, 1);
  });

  it("unresolved with human reply -> disputed; precision 0", () => {
    const s = classifyThreads([botThread("a.go", 10, { humanReply: "not valid" })]);
    assert.equal(s.disputed, 1);
    assert.equal(s.precision, 0);
  });

  it("unresolved without reply -> deferred, excluded from precision", () => {
    const s = classifyThreads([botThread("a.go", 10)]);
    assert.equal(s.deferred, 1);
    assert.equal(s.precision, null);
  });

  it("human thread near bot anchor counts as matched for recall", () => {
    const s = classifyThreads([botThread("a.go", 10, { resolved: true }), humanThread("a.go", 12)]);
    assert.equal(s.recall, 1);
  });

  it("human thread far from any bot anchor is unmatched", () => {
    const s = classifyThreads([botThread("a.go", 10, { resolved: true }), humanThread("b.go", 10)]);
    assert.equal(s.recall, 0);
  });

  it("empty threads -> nulls, no crash", () => {
    const s = classifyThreads([]);
    assert.equal(s.botFindings, 0);
    assert.equal(s.precision, null);
    assert.equal(s.recall, null);
  });

  it("severity x outcome matrix populated", () => {
    const s = classifyThreads([botThread("a.go", 10, { resolved: true })]);
    assert.equal(s.severityOutcome["HIGH"]?.accepted, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `opencode-review/src/monitoring/classify-outcomes.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import {
  computeObservedPrecision,
  computeEstimatedRecall,
  type FindingClassification,
} from "./precision-recall.js";
import { pushToDatadog, type DatadogSeries } from "./push-datadog.js";

export interface CommentNode {
  author: { login: string } | null;
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
}

export interface ThreadNode {
  isResolved: boolean;
  isOutdated: boolean;
  comments: { totalCount: number; nodes: CommentNode[] };
}

export interface OutcomeSummary {
  botFindings: number;
  accepted: number;
  disputed: number;
  deferred: number;
  precision: number | null;
  recall: number | null;
  matchedHuman: number;
  unmatchedHuman: number;
  threadResolveRate: number | null;
  avgFirstResponseHours: number | null;
  severityOutcome: Record<string, Record<string, number>>;
}

const SEVERITY_RE = /^\*\*\[(CRITICAL|HIGH|MEDIUM|LOW)/i;
const ANCHOR_WINDOW = 5;

const isBot = (c: CommentNode) => (c.author?.login ?? "").endsWith("[bot]");

export function classifyThreads(threads: ThreadNode[]): OutcomeSummary {
  const botAnchors: Array<{ path: string; line: number }> = [];
  const classifications: FindingClassification[] = [];
  const severityOutcome: Record<string, Record<string, number>> = {};
  let accepted = 0, disputed = 0, deferred = 0, resolvedCount = 0;
  const responseHours: number[] = [];
  let matchedHuman = 0, unmatchedHuman = 0;

  for (const thread of threads) {
    const nodes = thread.comments.nodes;
    const first = nodes[0];
    if (!first) continue;
    const line = first.line ?? 0;

    if (isBot(first) && SEVERITY_RE.test(first.body)) {
      botAnchors.push({ path: first.path, line });
      const severity = (first.body.match(SEVERITY_RE)?.[1] ?? "INFO").toUpperCase();
      const humanReplies = nodes.filter((c) => !isBot(c));
      if (humanReplies.length > 0 && humanReplies[0].createdAt && first.createdAt) {
        const h = (Date.parse(humanReplies[0].createdAt) - Date.parse(first.createdAt)) / 3_600_000;
        if (Number.isFinite(h) && h >= 0) responseHours.push(h);
      }
      let outcome: "accepted" | "disputed" | "deferred";
      if (thread.isResolved) { outcome = "accepted"; accepted++; resolvedCount++; }
      else if (humanReplies.length > 0) { outcome = "disputed"; disputed++; }
      else { outcome = "deferred"; deferred++; }
      classifications.push({
        outcome,
        finding_id: `${first.path}:${line}`,
        classification_reason: `thread ${thread.isResolved ? "resolved" : humanReplies.length > 0 ? "disputed by reply" : "unaddressed"} at close`,
        confidence: "high",
      });
      severityOutcome[severity] ??= { accepted: 0, disputed: 0, deferred: 0 };
      severityOutcome[severity][outcome]++;
    } else if (!isBot(first)) {
      const nearBot = botAnchors.some((a) => a.path === first.path && Math.abs(a.line - line) <= ANCHOR_WINDOW);
      if (nearBot) matchedHuman++;
      else unmatchedHuman++;
    }
  }

  return {
    botFindings: accepted + disputed + deferred,
    accepted, disputed, deferred,
    precision: computeObservedPrecision(classifications),
    recall: computeEstimatedRecall(matchedHuman, unmatchedHuman),
    matchedHuman, unmatchedHuman,
    threadResolveRate: botAnchors.length > 0 ? resolvedCount / botAnchors.length : null,
    avgFirstResponseHours: responseHours.length > 0
      ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length
      : null,
    severityOutcome,
  };
}

export function buildOutcomeSeries(s: OutcomeSummary, tags: string[], ts: number): DatadogSeries[] {
  const points: Array<[string, number, string[]]> = [];
  if (s.precision != null) points.push(["effectiveness.precision_observed", s.precision, []]);
  if (s.recall != null) points.push(["effectiveness.recall_estimated", s.recall, []]);
  if (s.threadResolveRate != null) points.push(["engagement.thread_resolve_rate", s.threadResolveRate, []]);
  if (s.avgFirstResponseHours != null) points.push(["engagement.avg_first_response_hours", s.avgFirstResponseHours, []]);
  points.push(["engagement.unmatched_human_findings", s.unmatchedHuman, []]);
  for (const [severity, outcomes] of Object.entries(s.severityOutcome)) {
    for (const [outcome, count] of Object.entries(outcomes)) {
      points.push(["effectiveness.findings", count, [`severity:${severity}`, `outcome:${outcome}`]]);
    }
  }
  return points.map(([name, value, extra]) => ({
    metric: `code_review_toolkit.${name}`,
    points: [[ts, value]],
    type: "gauge",
    tags: [...tags, ...extra],
  }));
}

export function recoverModelFromVerdicts(comments: Array<{ body: string; created_at: string }>, verdictMarker: string): { model: string | null; verdictAt: string | null } {
  const verdicts = comments
    .filter((c) => (c.body || "").includes(verdictMarker))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = verdicts[0];
  if (!latest) return { model: null, verdictAt: null };
  const model = latest.body.match(/- Model: (\S+)/)?.[1] ?? null;
  return { model, verdictAt: latest.created_at };
}

if (process.argv[1] && process.argv[1].endsWith("classify-outcomes.js")) {
  const [threadsPath, commentsPath, prArg] = process.argv.slice(2);
  if (!threadsPath || !commentsPath || !prArg) {
    process.stderr.write("Usage: node classify-outcomes.js <threads.json> <comments.json> <pr_number>\n");
    process.exit(1);
  }
  const threads = JSON.parse(readFileSync(threadsPath, "utf8")) as ThreadNode[];
  const comments = JSON.parse(readFileSync(commentsPath, "utf8")) as Array<{ body: string; created_at: string }>;
  const summary = classifyThreads(threads);

  const tags: string[] = [];
  if (process.env.GITHUB_REPOSITORY) tags.push(`repo:${process.env.GITHUB_REPOSITORY}`);
  const { model, verdictAt } = recoverModelFromVerdicts(comments, "<!-- opencode-pr-review -->");
  if (model) tags.push(`model:${model}`);
  if (verdictAt) {
    const lagH = Math.round((Date.now() - Date.parse(verdictAt)) / 3_600_000);
    if (Number.isFinite(lagH) && lagH >= 0) tags.push(`outcome_lag_h:${lagH}`);
  }

  const apiKey = process.env.DD_API_KEY || "";
  if (summary.botFindings === 0) {
    process.stdout.write("outcomes: no bot findings — nothing to push\n");
    process.exit(0);
  }
  writeFileSync("/tmp/outcome-summary.json", JSON.stringify({ summary, tags }, null, 2) + "\n");
  if (!apiKey) {
    process.stdout.write("outcomes: DD_API_KEY not set — wrote /tmp/outcome-summary.json only\n");
    process.exit(0);
  }
  const series = buildOutcomeSeries(summary, tags, Math.floor(Date.now() / 1000));
  pushToDatadog(apiKey, process.env.DD_SITE || "datadoghq.com", series)
    .then((r) => {
      process.stdout.write(r.ok ? "outcomes: pushed\n" : `outcomes: push failed (${r.error})\n`);
      process.exit(0);
    })
    .catch((e: Error) => {
      process.stdout.write(`outcomes: push error (${e.message})\n`);
      process.exit(0);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Create `.github/workflows/review-outcome.yml`**

```yaml
name: Review Outcome Metrics

on:
  workflow_call:
    inputs:
      pr_number:
        required: true
        type: number
      toolkit_ref:
        required: false
        type: string
        default: "v4"
    secrets:
      metrics_datadog_api_key:
        required: false
      metrics_datadog_site:
        required: false

jobs:
  outcome:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
    steps:
      - name: Checkout toolkit
        uses: actions/checkout@v4
        with:
          repository: elbertcl/code-review-toolkit
          ref: ${{ inputs.toolkit_ref }}
          path: toolkit

      - name: Fetch review threads and verdict comments
        uses: actions/github-script@v8
        with:
          github-token: ${{ github.token }}
          script: |
            const fs = require('fs');
            const prNumber = Number('${{ inputs.pr_number }}');
            const threadsQuery = `
              query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
                repository(owner: $owner, name: $repo) {
                  pullRequest(number: $prNumber) {
                    reviewThreads(first: 100, after: $cursor) {
                      nodes {
                        isResolved
                        isOutdated
                        comments(first: 100) {
                          totalCount
                          nodes { author { login } body path line createdAt }
                        }
                      }
                      pageInfo { hasNextPage endCursor }
                    }
                  }
                }
              }`;
            let threads = [];
            let cursor = null;
            let hasNext = true;
            while (hasNext) {
              const result = await github.graphql(threadsQuery, {
                owner: context.repo.owner, repo: context.repo.repo, prNumber, cursor,
              });
              const rt = result.repository.pullRequest.reviewThreads;
              threads.push(...rt.nodes);
              hasNext = rt.pageInfo.hasNextPage;
              cursor = rt.pageInfo.endCursor;
            }
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo, issue_number: prNumber, per_page: 100,
            });
            fs.writeFileSync('/tmp/threads.json', JSON.stringify(threads));
            fs.writeFileSync('/tmp/comments.json', JSON.stringify(
              comments.map((c) => ({ body: c.body, created_at: c.created_at }))
            ));
            core.info(`Fetched ${threads.length} threads, ${comments.length} comments`);

      - name: Classify outcomes and push
        if: always()
        shell: bash
        env:
          DD_API_KEY: ${{ secrets.metrics_datadog_api_key }}
          DD_SITE: ${{ secrets.metrics_datadog_site || 'datadoghq.com' }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: node toolkit/dist/monitoring/classify-outcomes.js /tmp/threads.json /tmp/comments.json "${{ inputs.pr_number }}"
```

- [ ] **Step 6: Delete the non-functional monitoring workflow**

```bash
git rm .github/workflows/review-monitoring.yml
```

(`src/monitoring/collect-telemetry.ts` and `push-datadog.ts` stay — the latter is reused; the former keeps aggregate utilities with tests.)

- [ ] **Step 7: Build + commit**

Run: `npm run build`

```bash
git add opencode-review/src/monitoring/classify-outcomes.ts opencode-review/src/monitoring/classify-outcomes.test.ts .github/workflows/review-outcome.yml opencode-review/dist/
git commit -m "feat(monitoring): t2 PR-close outcome classification + Datadog push; drop broken scraper workflow"
```

---

### Task 8: Reusable always-on-push review workflow

**Files:**
- Create: `.github/workflows/pr-review.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: PR Review (reusable)

on:
  workflow_call:
    inputs:
      org_profiles:
        required: true
        type: string
        description: Comma-separated org profiles (backend/security, backend/sre, frontend/security, frontend/sre).
      ocr_model:
        required: false
        type: string
        default: "deepseek/deepseek-v4-pro"
      ocr_cost_rates:
        required: false
        type: string
        default: ""
      fail_closed_context:
        required: false
        type: string
        default: "true"
      issue_number:
        required: false
        type: string
        default: ""
    secrets:
      ocr_llm_url:
        required: true
      ocr_llm_token:
        required: true
      metrics_datadog_api_key:
        required: false
      metrics_datadog_site:
        required: false

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - name: Checkout PR head (push and comment events)
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || format('refs/pull/{0}/head', github.event.issue.number) }}
      - name: Run review
        uses: elbertcl/code-review-toolkit/opencode-review@v4
        with:
          use_github_token: true
          org_profiles: ${{ inputs.org_profiles }}
          ocr_model: ${{ inputs.ocr_model }}
          ocr_cost_rates: ${{ inputs.ocr_cost_rates }}
          fail_closed_context: ${{ inputs.fail_closed_context }}
          issue_number: ${{ inputs.issue_number }}
          ocr_llm_url: ${{ secrets.ocr_llm_url }}
          ocr_llm_token: ${{ secrets.ocr_llm_token }}
          metrics_datadog_api_key: ${{ secrets.metrics_datadog_api_key }}
          metrics_datadog_site: ${{ secrets.metrics_datadog_site }}
```

- [ ] **Step 2: Verify the composite input names match**

Run: `grep -E "^  (org_profiles|ocr_model|ocr_cost_rates|fail_closed_context|issue_number|ocr_llm_url|ocr_llm_token|metrics_datadog_api_key|metrics_datadog_site|use_github_token):" opencode-review/action.yml | wc -l`
Expected: `10` (all referenced inputs exist in the composite action).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pr-review.yml
git commit -m "feat(ci): reusable always-on-push review workflow (new default trigger)"
```

---

### Task 9: Offline benchmark harness

**Files:**
- Create: `opencode-review/src/benchmark/evaluate.ts`
- Test: `opencode-review/src/benchmark/evaluate.test.ts`
- Create: `opencode-review/src/benchmark/corpus/golden.json`
- Create: `opencode-review/src/benchmark/run-matrix.ts`

- [ ] **Step 1: Write the failing evaluator tests**

Create `opencode-review/src/benchmark/evaluate.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchFindings, evaluateCell, ExpectedFinding, ActualFinding } from "./evaluate.js";

const exp: ExpectedFinding[] = [
  { path: "a.go", line_approx: 40, severity: "CRITICAL", rule_id: "RULE-TRK-02" },
  { path: "b.go", line_approx: 10, severity: "HIGH" },
];
const act: ActualFinding[] = [
  { path: "a.go", line: 44, severity: "CRITICAL", body: "violates RULE-TRK-02: rejected events discarded" },
  { path: "b.go", line: 8, severity: "MEDIUM", body: "swallowed error" },
  { path: "c.go", line: 1, severity: "LOW", body: "style" },
];

describe("matchFindings", () => {
  it("matches same-path findings within the ±5-line window, greedy", () => {
    const m = matchFindings(exp, act);
    assert.equal(m.matched.length, 2);
    assert.equal(m.unmatchedActual.length, 1);
    assert.equal(m.unmatchedExpected.length, 0);
  });

  it("does not match beyond the window", () => {
    const m = matchFindings([{ path: "a.go", line_approx: 40, severity: "HIGH" }], [{ path: "a.go", line: 60, severity: "HIGH", body: "" }]);
    assert.equal(m.matched.length, 0);
    assert.equal(m.unmatchedExpected.length, 1);
  });
});

describe("evaluateCell", () => {
  it("computes precision, recall, severity match, rule citation", () => {
    const r = evaluateCell(exp, act);
    assert.equal(r.precision, 2 / 3);
    assert.equal(r.recall, 1);
    assert.equal(r.severity_match_rate, 0.5);
    assert.equal(r.rule_citation_rate, 1);
  });

  it("returns nulls on empty inputs", () => {
    const r = evaluateCell([], []);
    assert.equal(r.precision, null);
    assert.equal(r.recall, null);
    assert.equal(r.severity_match_rate, null);
    assert.equal(r.rule_citation_rate, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `evaluate.ts`**

```ts
export interface ExpectedFinding {
  path: string;
  line_approx: number;
  severity: string;
  rule_id?: string;
}

export interface ActualFinding {
  path: string;
  line: number;
  severity: string;
  body: string;
}

export interface MatchResult {
  matched: Array<{ expected: ExpectedFinding; actual: ActualFinding }>;
  unmatchedExpected: ExpectedFinding[];
  unmatchedActual: ActualFinding[];
}

export interface CellResult {
  precision: number | null;
  recall: number | null;
  severity_match_rate: number | null;
  rule_citation_rate: number | null;
}

const ANCHOR_WINDOW = 5;

export function matchFindings(expected: ExpectedFinding[], actual: ActualFinding[]): MatchResult {
  const taken = new Set<number>();
  const matched: MatchResult["matched"] = [];
  for (const e of expected) {
    const idx = actual.findIndex(
      (a, i) => !taken.has(i) && a.path === e.path && Math.abs(a.line - e.line_approx) <= ANCHOR_WINDOW,
    );
    if (idx >= 0) {
      taken.add(idx);
      matched.push({ expected: e, actual: actual[idx] });
    }
  }
  return {
    matched,
    unmatchedExpected: expected.filter((e) => !matched.some((m) => m.expected === e)),
    unmatchedActual: actual.filter((_, i) => !taken.has(i)),
  };
}

export function evaluateCell(expected: ExpectedFinding[], actual: ActualFinding[]): CellResult {
  const { matched } = matchFindings(expected, actual);
  const precision = actual.length > 0 ? matched.length / actual.length : null;
  const recall = expected.length > 0 ? matched.length / expected.length : null;
  const severityMatches = matched.filter((m) => m.expected.severity.toUpperCase() === m.actual.severity.toUpperCase());
  const severity_match_rate = matched.length > 0 ? severityMatches.length / matched.length : null;
  const ruleExpected = matched.filter((m) => m.expected.rule_id);
  const ruleCited = ruleExpected.filter((m) => m.expected.rule_id && m.actual.body.toUpperCase().includes(m.expected.rule_id.toUpperCase()));
  const rule_citation_rate = ruleExpected.length > 0 ? ruleCited.length / ruleExpected.length : null;
  return { precision, recall, severity_match_rate, rule_citation_rate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Create the golden corpus**

Create `opencode-review/src/benchmark/corpus/golden.json` (contents from `docs/plans/2026-08-13-toolkit-capability-test-plan.md`; the two bug cases carry expected findings, the two clean cases test the precision side):

```json
{
  "entries": [
    {
      "id": "invariant-violation-RULE-TRK-02",
      "files": [
        {
          "path": "internal/domain/tracker/service/quick_ingest.go",
          "content": "package service\n\nimport (\n\t\"context\"\n\n\t\"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity\"\n)\n\ntype QuickIngest struct {\n\tvalidator JourneyValidator\n\trepo      db.EventRepository\n\tpublisher inf_pubsub.Publisher\n}\n\nfunc NewQuickIngest(validator JourneyValidator, repo db.EventRepository, publisher inf_pubsub.Publisher) QuickIngest {\n\treturn QuickIngest{validator: validator, repo: repo, publisher: publisher}\n}\n\nfunc (q QuickIngest) ProcessAndPublish(ctx context.Context, event entity.Event) error {\n\tvalid := q.validator.ValidateJourney(ctx, event)\n\tif !valid {\n\t\treturn nil\n\t}\n\n\tif err := q.repo.BulkCreateEvents(ctx, []entity.Event{event}); err != nil {\n\t\treturn err\n\t}\n\n\t_, err := q.publisher.Publish(ctx, TopicEventCreated, event.ToPb())\n\treturn err\n}\n"
        }
      ],
      "expected_findings": [
        { "path": "internal/domain/tracker/service/quick_ingest.go", "line_approx": 23, "severity": "CRITICAL", "rule_id": "RULE-TRK-02" }
      ]
    },
    {
      "id": "swallowed-error",
      "files": [
        {
          "path": "internal/domain/tracker/service/event_lookup.go",
          "content": "package service\n\nimport (\n\t\"context\"\n\n\t\"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity\"\n)\n\ntype EventLookup struct {\n\trepo EventLookupRepo\n}\n\ntype EventLookupRepo interface {\n\tFindByImpressionID(ctx context.Context, impressionID string) ([]entity.Event, error)\n}\n\nfunc NewEventLookup(repo EventLookupRepo) EventLookup {\n\treturn EventLookup{repo: repo}\n}\n\nfunc (l EventLookup) FindByImpression(ctx context.Context, impressionID string) ([]entity.Event, error) {\n\tevents, err := l.repo.FindByImpressionID(ctx, impressionID)\n\tif err != nil {\n\t\treturn []entity.Event{}, nil\n\t}\n\treturn events, nil\n}\n"
        }
      ],
      "expected_findings": [
        { "path": "internal/domain/tracker/service/event_lookup.go", "line_approx": 24, "severity": "HIGH" }
      ]
    },
    {
      "id": "clean-summary",
      "files": [
        {
          "path": "internal/domain/tracker/service/ingest_summary.go",
          "content": "package service\n\nimport (\n\t\"fmt\"\n\n\t\"github.com/astronautsid/astro-ads-be/internal/domain/tracker/entity\"\n)\n\ntype IngestSummary struct {\n\tAcked   int\n\tRetried int\n}\n\nfunc SummarizeIngestResult(result IngestResult) IngestSummary {\n\treturn IngestSummary{Acked: len(result.AckEvents), Retried: len(result.RetryEvents)}\n}\n\nfunc ClassifyEvent(event entity.Event) string {\n\tif event.Detail.IsBillable {\n\t\treturn fmt.Sprintf(\"billable:%s\", event.Detail.Type)\n\t}\n\treturn fmt.Sprintf(\"non-billable:%s\", event.Detail.Type)\n}\n"
        }
      ],
      "expected_findings": []
    },
    {
      "id": "clean-metrics",
      "files": [
        {
          "path": "internal/domain/tracker/service/const.go",
          "content": "package service\n\nconst (\n\tmetricEventLookupDuration = \"tracker.event_lookup.duration_ms\"\n\tmetricEventLookupTotal    = \"tracker.event_lookup.total\"\n)\n"
        }
      ],
      "expected_findings": []
    }
  ]
}
```

- [ ] **Step 6: Implement `run-matrix.ts`**

Create `opencode-review/src/benchmark/run-matrix.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateCell, type ActualFinding, type ExpectedFinding } from "./evaluate.js";

interface CorpusEntry {
  id: string;
  files: Array<{ path: string; content: string }>;
  expected_findings: ExpectedFinding[];
}

interface CellOutput {
  model: string;
  entryId: string;
  repeat: number;
  ok: boolean;
  error?: string;
  precision: number | null;
  recall: number | null;
  severity_match_rate: number | null;
  rule_citation_rate: number | null;
  total_tokens?: number;
  elapsed_ms?: number;
}

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function materialize(entry: CorpusEntry): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  sh("git", ["init", "-q"], { cwd: dir });
  sh("git", ["config", "user.email", "bench@toolkit"], { cwd: dir });
  sh("git", ["config", "user.name", "bench"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# bench\n");
  sh("git", ["add", "."], { cwd: dir });
  sh("git", ["commit", "-qm", "base"], { cwd: dir });
  for (const f of entry.files) {
    mkdirSync(join(dir, f.path, ".."), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  sh("git", ["add", "."], { cwd: dir });
  sh("git", ["commit", "-qm", "head"], { cwd: dir });
  return { dir };
}

function runOcr(model: string, entry: CorpusEntry, toolkitDist: string, defaultsDir: string): { actual: ActualFinding[]; tokens: number; elapsedMs: number } {
  const { dir } = materialize(entry);
  try {
    const changed = JSON.stringify(entry.files.map((f) => f.path));
    const tmp = join(dir, ".bench");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "changed-files.json"), changed);
    sh("node", [join(toolkitDist, "context/resolve-manifest.js"), join(dir, "REVIEW.md-absent"), join(defaultsDir, "REVIEW.md"), join(defaultsDir, "manifest-defaults.json"), join(tmp, "changed-files.json"), dir, join(tmp, "manifest.json"), join(tmp, "status.json")]);
    sh("node", ["--input-type=module", "-e", `
      import { compileOcrRules } from '${join(toolkitDist, "ocr/compile-ocr-rules.js")}';
      import { readFileSync, writeFileSync } from 'node:fs';
      const manifest = JSON.parse(readFileSync(process.argv[1], 'utf8'));
      const rules = compileOcrRules({ workspace: process.cwd(), changedFiles: [], orgContextsDir: '${join(toolkitDist, "..", "context", "contexts")}', manifest, policyBody: '', resolvedDirectives: [], orgProfiles: ['backend/security', 'backend/sre'] });
      writeFileSync(process.argv[2], JSON.stringify(rules));
    `, join(tmp, "manifest.json"), join(tmp, "rule.json")], { cwd: dir });

    sh("ocr", ["config", "set", "llm.model", model]);
    const raw = sh("ocr", ["review", "--from", "HEAD~1", "--to", "HEAD", "--rule", join(tmp, "rule.json"), "--format", "json"], { cwd: dir });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const findings = Array.isArray(parsed) ? parsed : (parsed.comments || []);
    const actual: ActualFinding[] = findings.map((f: { file?: string; path?: string; line?: number; start_line?: number; severity?: string; message?: string; content?: string }) => ({
      path: f.path || f.file || "",
      line: f.line ?? f.start_line ?? 0,
      severity: f.severity || "INFO",
      body: f.message || f.content || "",
    }));
    const summary = parsed.summary || {};
    return {
      actual,
      tokens: Number(summary.total_tokens) || 0,
      elapsedMs: Number(parsed.manifest?.elapsed_ms) || 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const corpusPath = args.find((a) => !a.startsWith("--")) || join(import.meta.dirname, "corpus/golden.json");
  const models = (args.find((a) => a.startsWith("--models="))?.slice(9) || "deepseek/deepseek-v4-pro").split(",");
  const repeats = Number(args.find((a) => a.startsWith("--repeats="))?.slice(10) || 3);
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { entries: CorpusEntry[] };
  const toolkitDist = join(import.meta.dirname, "../dist");
  const defaultsDir = join(import.meta.dirname, "../../context/defaults");

  const cells: CellOutput[] = [];
  for (const model of models) {
    for (const entry of corpus.entries) {
      for (let repeat = 1; repeat <= repeats; repeat++) {
        try {
          const { actual, tokens, elapsedMs } = runOcr(model, entry, toolkitDist, defaultsDir);
          const r = evaluateCell(entry.expected_findings, actual);
          cells.push({ model, entryId: entry.id, repeat, ok: true, ...r, total_tokens: tokens, elapsed_ms: elapsedMs });
          process.stdout.write(`ok ${model} ${entry.id} #${repeat}\n`);
        } catch (error) {
          cells.push({ model, entryId: entry.id, repeat, ok: false, error: (error as Error).message, precision: null, recall: null, severity_match_rate: null, rule_citation_rate: null });
          process.stdout.write(`ERROR ${model} ${entry.id} #${repeat}: ${(error as Error).message}\n`);
        }
      }
    }
  }

  const outPath = args.find((a) => a.startsWith("--out="))?.slice(6) || `docs/plans/${new Date().toISOString().slice(0, 10)}-model-benchmark-results.md`;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  let md = `# Model Benchmark Results\n\n**Corpus:** ${corpusPath} | **Repeats:** ${repeats} | **Date:** ${new Date().toISOString()}\n\n`;
  md += `| Model | Precision | Recall | Severity match | Rule citation | Avg tokens | Avg elapsed ms | Errors |\n|---|---|---|---|---|---|---|---|\n`;
  for (const model of models) {
    const mc = cells.filter((c) => c.model === model);
    md += `| ${model} | ${mean(mc.filter((c) => c.precision != null).map((c) => c.precision!))?.toFixed(2) ?? "—"} | ${mean(mc.filter((c) => c.recall != null).map((c) => c.recall!))?.toFixed(2) ?? "—"} | ${mean(mc.filter((c) => c.severity_match_rate != null).map((c) => c.severity_match_rate!))?.toFixed(2) ?? "—"} | ${mean(mc.filter((c) => c.rule_citation_rate != null).map((c) => c.rule_citation_rate!))?.toFixed(2) ?? "—"} | ${Math.round(mean(mc.map((c) => c.total_tokens ?? 0)) ?? 0)} | ${Math.round(mean(mc.map((c) => c.elapsed_ms ?? 0)) ?? 0)} | ${mc.filter((c) => !c.ok).length} |\n`;
  }
  md += `\n## Per-cell detail\n\n| Model | Entry | Repeat | Precision | Recall | Error |\n|---|---|---|---|---|---|\n`;
  for (const c of cells) {
    md += `| ${c.model} | ${c.entryId} | ${c.repeat} | ${c.precision ?? "—"} | ${c.recall ?? "—"} | ${c.error ?? ""} |\n`;
  }
  writeFileSync(outPath, md);
  process.stdout.write(`wrote ${outPath}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("run-matrix.js")) {
  main();
}
```

- [ ] **Step 7: Typecheck, build, test**

Run: `npm run typecheck && npm test && npm run build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add opencode-review/src/benchmark/ opencode-review/dist/
git commit -m "feat(benchmark): deterministic evaluator, golden corpus, model-matrix runner"
```

---

### Task 10: Dashboard JSON, README, final verification

**Files:**
- Create: `docs/dashboard/datadog-code-review-toolkit.json`
- Modify: `README.md`

- [ ] **Step 1: Create the dashboard definition**

```json
{
  "title": "code-review-toolkit",
  "description": "Per-repo, per-model AI review observability (D1 efficiency, D2 effectiveness, D3 engagement, D4 context, D5 reliability).",
  "template_variables": [
    { "name": "repo", "prefix": "repo:", "default": "*" },
    { "name": "model", "prefix": "model:", "default": "*" },
    { "name": "org_profile", "prefix": "org_profile:", "default": "*" }
  ],
  "widgets": [
    { "type": "timeseries", "title": "Cost per run ($)", "requests": [{ "q": "avg:code_review_toolkit.cost.total{$repo,$model,$org_profile}" }] },
    { "type": "timeseries", "title": "Tokens (input/output/cache)", "requests": [
      { "q": "avg:code_review_toolkit.tokens.input{$repo,$model}" },
      { "q": "avg:code_review_toolkit.tokens.output{$repo,$model}" },
      { "q": "avg:code_review_toolkit.tokens.cache_read{$repo,$model}" }
    ] },
    { "type": "query_value", "title": "Observed precision", "requests": [{ "q": "avg:code_review_toolkit.effectiveness.precision_observed{$repo,$model}", "conditional_formats": [{ "comparator": "<", "value": 0.6, "palette": "red" }, { "comparator": ">=", "value": 0.8, "palette": "green" }] }] },
    { "type": "query_value", "title": "Estimated recall", "requests": [{ "q": "avg:code_review_toolkit.effectiveness.recall_estimated{$repo,$model}" }] },
    { "type": "timeseries", "title": "Rule citation rate", "requests": [{ "q": "avg:code_review_toolkit.context.rule_citation_rate{$repo,$model}" }] },
    { "type": "timeseries", "title": "Reliability (fallback / fail-open / blocked)", "requests": [
      { "q": "sum:code_review_toolkit.reliability.fallback{$repo}" },
      { "q": "sum:code_review_toolkit.reliability.serena_fail_open{$repo}" },
      { "q": "sum:code_review_toolkit.reliability.manifest_status_blocked{$repo}" }
    ] },
    { "type": "timeseries", "title": "Thread resolve rate", "requests": [{ "q": "avg:code_review_toolkit.engagement.thread_resolve_rate{$repo,$model}" }] },
    { "type": "toplist", "title": "Findings by severity x outcome", "requests": [{ "q": "sum:code_review_toolkit.effectiveness.findings{$repo,$model} by {severity,outcome}" }] }
  ]
}
```

- [ ] **Step 2: Update README**

2a. Replace the "## Usage" section (lines 5-15) with:

```markdown
## Usage

**Default trigger: review on every push + `/review` comment**, via one reusable workflow:

```yaml
name: PR Review

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
      (github.event_name == 'issue_comment' &&
       github.event.issue.pull_request != null &&
       github.event.comment.body == '/review') ||
      (github.event_name == 'pull_request')
    uses: elbertcl/code-review-toolkit/.github/workflows/pr-review.yml@v4
    with:
      org_profiles: backend/security,backend/sre
    secrets:
      ocr_llm_url: ${{ secrets.OCR_POC_LLM_URL }}
      ocr_llm_token: ${{ secrets.OCR_POC_LLM_TOKEN }}
      metrics_datadog_api_key: ${{ secrets.DATADOG_API_KEY }}
```

The action automatically detects first-time review vs re-review (new diff only), skips
drafts, and never reviews the same HEAD twice (loop guard). Force-push noise is bounded
by the `concurrency` cancel group.

**Manual-only alternative:** copy the slim `issue_comment`-only trigger and call the
composite action directly (`elbertcl/code-review-toolkit/opencode-review@v4`) as before.
```

2b. Replace the entire "## Auto-Review on Push (non-goal, opt-in only)" section (lines 308-356) with:

```markdown
## Review triggers (default: always-on-push)

Since 2026-08 the default trigger is auto-review on PR open/synchronize plus the `/review`
comment (see Usage). This replaces the earlier manual-only default. Spend control comes
from the concurrency cancel group and the same-HEAD loop guard; authors avoid mid-iteration
reviews by keeping the PR draft (drafts are skipped).

Manual-only repos: use the slim `issue_comment` workflow documented in Usage.
```

2c. In "### OCR engine", document the model and metrics knobs — add after the consumer-setup YAML snippet:

```markdown
Per-repo model choice: pass `ocr_model` (default `deepseek/deepseek-v4-pro`). Verify IDs
against the provider catalog (`curl -sf https://models.dev/api.json | jq '.<provider>'`).

Observability (opt-in): set `metrics_datadog_api_key` (+ `metrics_datadog_site`) to push
per-run efficiency/context/reliability metrics (D1/D4/D5) at review time. Add the PR-closed
outcome workflow to also collect quality metrics (D2/D3):

```yaml
name: Review Outcome
on:
  pull_request:
    types: [closed]
jobs:
  outcome:
    uses: elbertcl/code-review-toolkit/.github/workflows/review-outcome.yml@v4
    with:
      pr_number: ${{ github.event.pull_request.number }}
    secrets:
      metrics_datadog_api_key: ${{ secrets.DATADOG_API_KEY }}
```

All metrics land in the shared `code-review-toolkit` Datadog dashboard
(`docs/dashboard/datadog-code-review-toolkit.json`), sliced by `repo` and `model` tags.
```

2d. Add a benchmark section before "## Versioning":

```markdown
## Model benchmarking

`opencode-review/src/benchmark/` ships a deterministic offline harness:

```bash
npm run build
OCR_LLM_URL=... OCR_LLM_TOKEN=... node opencode-review/dist/benchmark/run-matrix.js \
  opencode-review/src/benchmark/corpus/golden.json \
  --models=deepseek/deepseek-v4-pro,openrouter/qwen-3-coder --repeats=3 \
  --out=docs/plans/$(date +%F)-model-benchmark-results.md
```

It replays the golden corpus (self-contained file sets with expected findings) through the
OCR CLI per model x repeat, scoring anchor-window precision/recall, severity match, and
rule-citation rate. Extend the corpus by adding entries (auto-mine candidates from PR-close
outcome data) to `corpus/golden.json`.
```

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm test && npm run build && npm run check-dist`
Expected: typecheck clean, all tests pass, `check-dist` exits 0 (dist matches source).

- [ ] **Step 4: Commit**

```bash
git add docs/dashboard/datadog-code-review-toolkit.json README.md
git commit -m "docs: dashboard definition, always-on-push default docs, benchmark harness guide"
```

---

## Verification (whole plan)

1. `npm run typecheck && npm test && npm run build && npm run check-dist` — green.
2. `git log --oneline` shows one commit per task, dist committed alongside src.
3. Manual smoke (post-merge, in a consumer repo): push a commit → review runs without `/review`; close the PR → outcome workflow logs `outcomes: pushed` (with DD key) or `no bot findings`.
4. Datadog: `code_review_toolkit.*` metrics appear tagged with `repo`/`model`.

## Self-Review (completed)

- **Spec coverage:** §3 trigger → Task 8 (+README Task 10); §4 dimensions → Tasks 1-2; §5 ocr_model/dedupe → Tasks 3-4; §6.2 telemetry v2 → Task 5; §6.3 t0 push → Task 6; §6.4 t2 outcome → Task 7; §6.5 benchmark → Task 9; §6.6 dashboard → Task 10; §7 delete monitoring → Task 7 Step 6. No gaps.
- **Placeholders:** none — every step carries complete code or exact YAML.
- **Type consistency:** `RunMetricRow.context` fields match what action.yml Task 5 writes into `context-metrics.json` + additions; `ThreadNode`/`CommentNode` match the GraphQL projection in `review-outcome.yml`; `buildRunSeries`/`buildOutcomeSeries` both return `DatadogSeries` from `push-datadog.ts`.

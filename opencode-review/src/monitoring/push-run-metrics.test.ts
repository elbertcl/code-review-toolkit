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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRunMetrics, RunMetricRow } from "./push-run-metrics.js";

describe("buildRunMetrics", () => {
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

  it("builds attributed gauges with prefixed names", () => {
    const metrics = buildRunMetrics(row);
    assert.ok(metrics.length >= 10);
    for (const m of metrics) {
      assert.ok(m.name.startsWith("code_review_toolkit."));
      assert.equal(typeof m.value, "number");
      assert.equal(m.attributes!.repo, "astronautsid/astro-ads-be");
      assert.equal(m.attributes!.model, "deepseek/deepseek-v4-pro");
      assert.equal(m.attributes!.mode, "review");
      assert.equal(m.attributes!.verdict, "FAIL");
    }
    const names = metrics.map((m) => m.name);
    assert.ok(names.includes("code_review_toolkit.tokens.input"));
    assert.ok(names.includes("code_review_toolkit.cost.total"));
    assert.ok(names.includes("code_review_toolkit.context.rule_citation_rate"));
    assert.ok(names.includes("code_review_toolkit.context.rules_compiled"));
  });

  it("encodes org profiles as one attribute per profile", () => {
    const metrics = buildRunMetrics(row);
    assert.equal(metrics[0].attributes!.org_profile_backend_security, "backend/security");
    assert.equal(metrics[0].attributes!.org_profile_backend_sre, "backend/sre");
  });

  it("emits reliability gauges for degraded runs", () => {
    const degraded: RunMetricRow = {
      ...row,
      serena: { status: "unavailable" },
      context: { ...row.context!, manifest_status: "BLOCKED", fallback_reason: "REVIEW.md not found" },
    };
    const names = buildRunMetrics(degraded).map((m) => m.name);
    assert.ok(names.includes("code_review_toolkit.reliability.serena_fail_open"));
    assert.ok(names.includes("code_review_toolkit.reliability.fallback"));
    assert.ok(names.includes("code_review_toolkit.reliability.manifest_status_blocked"));
  });

  it("handles a minimal row without optional fields", () => {
    const metrics = buildRunMetrics({ pr: 1, repo: "o/r", model: "m" } as RunMetricRow);
    assert.equal(metrics.length, 0);
  });
});

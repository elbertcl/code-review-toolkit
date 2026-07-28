import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { renderDashboard, summarizeMetrics } from "./render-metrics-dashboard.mjs";

test("summary formulas are null when their denominator is zero", () => {
  assert.deepEqual(summarizeMetrics([]), {
    schema_version: 1,
    generated_from: "sanitized_metadata",
    total_findings: 0,
    outcomes: { accepted: 0, disputed: 0, deferred: 0, unclassified: 0 },
    acceptance_rate: null,
    classification_rate: null,
    observed_precision: null,
    estimated_recall: null,
    breakdowns: { repository: {}, severity: {}, model: {} },
    latency_ms: { p50: null, p95: null },
    cost_usd: { p50: null, p95: null },
    counts: { rejected: 0, failed: 0, confidence: {} },
  });
});

test("renders deterministic sanitized dashboard artifacts", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "metrics-"));
  const records = [
    { repository: "owner/<repo>", pr_number: 2, finding_id: "arf_b", thread_id: "T2", dimension: "security", severity: "HIGH", outcome: "disputed", finding_created_at: "2026-01-02", pr_merged_at: null, toolkit_sha: "b".repeat(40), provider: "p", model: "p/m", body: "private full comment", diff: "private source" },
    { repository: "owner/repo", pr_number: 1, finding_id: "arf_a", thread_id: "T1", dimension: "sre", severity: "MEDIUM", outcome: "accepted", finding_created_at: "2026-01-01", pr_merged_at: "2026-01-03", toolkit_sha: "b".repeat(40), provider: "p", model: "p/m" },
  ];
  await renderDashboard(records, output, { generatedAt: "2026-01-04T00:00:00.000Z", auditSampleSize: 2 });

  const summary = JSON.parse(await readFile(path.join(output, "summary.json"), "utf8"));
  const audit = JSON.parse(await readFile(path.join(output, "audit-sample.json"), "utf8"));
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.equal(summary.acceptance_rate, 0.5);
  assert.equal(summary.classification_rate, 1);
  assert.equal(summary.generated_at, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(audit.records.map(({ finding_id }) => finding_id), ["arf_a", "arf_b"]);
  assert.doesNotMatch(JSON.stringify(audit), /private full comment|private source|body|diff/);
  assert.match(html, /AI Review Metrics/);
  assert.match(html, /owner\/&lt;repo&gt;/);
  assert.doesNotMatch(html, /owner\/<repo>/);
});

test("computes precision, estimated recall, breakdowns, percentiles, and failure counts", () => {
  const records = [
    { repository: "a/r", severity: "HIGH", model: "p/m", outcome: "accepted", confidence: "high", review_latency_ms: 100, review_cost_usd: 0.1, matched_qualifying_human: true, unmatched_qualifying_human_count: 1 },
    { repository: "a/r", severity: "HIGH", model: "p/m", outcome: "disputed", confidence: "low", review_latency_ms: 300, review_cost_usd: 0.3, matched_qualifying_human: false, unmatched_qualifying_human_count: 0 },
    { repository: "b/r", severity: "MEDIUM", model: "q/m", outcome: "unclassified", confidence: null, review_latency_ms: null, review_cost_usd: null, collection_status: "failed", matched_qualifying_human: false, unmatched_qualifying_human_count: 0 },
  ];
  const summary = summarizeMetrics(records);
  assert.equal(summary.observed_precision, 0.5);
  assert.equal(summary.estimated_recall, 0.5);
  assert.deepEqual(summary.latency_ms, { p50: 100, p95: 300 });
  assert.deepEqual(summary.cost_usd, { p50: 0.1, p95: 0.3 });
  assert.deepEqual(summary.counts, { rejected: 1, failed: 1, confidence: { high: 1, low: 1, unknown: 1 } });
  assert.equal(summary.breakdowns.repository["a/r"].total, 2);
  assert.equal(summary.breakdowns.severity.HIGH.accepted, 1);
  assert.equal(summary.breakdowns.model["q/m"].total, 1);
});

test("human-only aggregate records affect recall but not AI finding totals", () => {
  const summary = summarizeMetrics([{ record_type: "human_baseline", repository: "a/r", unmatched_qualifying_human_count: 2 }]);
  assert.equal(summary.total_findings, 0);
  assert.equal(summary.estimated_recall, 0);
});

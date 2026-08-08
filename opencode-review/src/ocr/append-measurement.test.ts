import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMeasurementRow } from "./append-measurement.js";

describe("buildMeasurementRow", () => {
  it("produces an ocr lane row with severity tally", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [{ severity: "High" }, { severity: "Critical" }, { severity: "Medium" }],
      suppressed: 1,
      tokens: { total: 5000 },
      prNumber: 42,
      sha: "abc123",
      cost: null,
      elapsedMs: null,
    });

    assert.equal(row.lane, "ocr");
    assert.equal(row.context.verdict, "clean");
    assert.equal(row.suppressed_as_duplicate, 1);
    assert.equal(row.tokens.source, "ocr_native");
    assert.equal(row.tokens.total, 5000);
    assert.equal(row.severity_tally.High, 1);
    assert.equal(row.severity_tally.Critical, 1);
    assert.equal(row.severity_tally.Medium, 1);
    assert.equal(row.pr, 42);
  });

  it("handles empty findings", () => {
    const row = buildMeasurementRow({
      verdict: "no_issues",
      findings: [],
      suppressed: 0,
      tokens: { total: 2000 },
      prNumber: 1,
      sha: "def456",
      cost: null,
      elapsedMs: null,
    });

    assert.equal(row.severity_tally.Critical, 0);
    assert.equal(row.suppressed_as_duplicate, 0);
  });

  it("includes timestamp, sha, and pr number", () => {
    const row = buildMeasurementRow({
      verdict: "flagged",
      findings: [],
      suppressed: 0,
      tokens: { total: 0 },
      prNumber: 99,
      sha: "sha999",
      cost: null,
      elapsedMs: null,
    });

    assert.equal(row.pr, 99);
    assert.equal(row.sha, "sha999");
    assert.ok(typeof row.timestamp === "string");
    assert.ok(row.timestamp.length > 0);
  });

  it("sums token total from input tokens object", () => {
    const row = buildMeasurementRow({
      verdict: "clean",
      findings: [],
      suppressed: 0,
      tokens: { total: 3000 },
      prNumber: 7,
      sha: "abc",
      cost: null,
      elapsedMs: null,
    });

    assert.equal(row.tokens.total, 3000);
  });

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
});

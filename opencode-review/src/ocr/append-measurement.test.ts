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
    });

    assert.equal(row.tokens.total, 3000);
  });
});

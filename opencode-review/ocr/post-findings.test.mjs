import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFindings } from "./post-findings.mjs";

describe("computeFindings", () => {
  const sampleFindings = [
    { path: "internal/a.go", line: 10, severity: "High", category: "Performance", message: "N+1 query" },
    { path: "internal/b.go", line: 20, severity: "Critical", category: "Correctness", message: "missing audit column" },
    { path: "internal/b.go", "end_line": 25, severity: "Medium", category: "Style", message: "magic number" },
  ];

  it("keeps findings not matched by anchors", () => {
    const anchors = [{ path: "internal/a.go", line: 10 }];
    const result = computeFindings({ findings: sampleFindings, anchors });
    assert.equal(result.kept.length, 2);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].path, "internal/a.go");
  });

  it("matches by end_line when start_line is absent", () => {
    const anchors = [{ path: "internal/b.go", line: 25 }];
    const result = computeFindings({ findings: sampleFindings, anchors });
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].message, "magic number");
  });

  it("formats kept findings as OCR POC comments", () => {
    const result = computeFindings({ findings: sampleFindings, anchors: [] });
    assert.equal(result.comments.length, 3);
    const firstComment = result.comments[0];
    assert.match(firstComment.body, /\[OCR POC\]/);
    assert.match(firstComment.body, /\[High\/Performance\]/);
    assert.match(firstComment.body, /N\+1 query/);
    assert.equal(firstComment.path, "internal/a.go");
  });

  it("returns summary message when kept is empty", () => {
    const anchors = [
      { path: "internal/a.go", line: 10 },
      { path: "internal/b.go", line: 20 },
      { path: "internal/b.go", line: 25 },
    ];
    const result = computeFindings({ findings: sampleFindings, anchors });
    assert.equal(result.kept.length, 0);
    assert.ok(result.message);
    assert.match(result.message, /3 previously flagged/);
  });

  it("returns empty comments when findings is empty", () => {
    const result = computeFindings({ findings: [], anchors: [] });
    assert.deepStrictEqual(result.comments, []);
    assert.equal(result.kept.length, 0);
  });
});
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFindings, buildVerdictComment } from "./post-findings.js";

describe("computeFindings", () => {
  const sampleFindings = [
    { path: "internal/a.go", line: 10, severity: "High", category: "Performance", message: "N+1 query" },
    { path: "internal/b.go", line: 20, severity: "Critical", category: "Correctness", message: "missing audit column" },
    { path: "internal/b.go", "end_line": 25, severity: "Medium", category: "Style", message: "magic number" },
  ];

  it("keeps findings not matched by anchors", () => {
    const anchors = [{ path: "internal/a.go", line: 10, is_resolved: false }];
    const result = computeFindings({ findings: sampleFindings, anchors });
    assert.equal(result.kept.length, 2);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.resolved.length, 0);
    assert.equal(result.dropped[0].path, "internal/a.go");
  });

  it("matches by end_line when start_line is absent", () => {
    const anchors = [{ path: "internal/b.go", line: 25, is_resolved: false }];
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
      { path: "internal/a.go", line: 10, is_resolved: false },
      { path: "internal/b.go", line: 20, is_resolved: false },
      { path: "internal/b.go", line: 25, is_resolved: false },
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

  it("sorts findings into resolved bucket for resolved anchors", () => {
    const anchors = [
      { path: "internal/a.go", line: 10, is_resolved: true },
      { path: "internal/b.go", line: 20, is_resolved: false },
    ];
    const result = computeFindings({ findings: sampleFindings, anchors });
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].path, "internal/a.go");
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].path, "internal/b.go");
    assert.equal(result.kept.length, 1);
  });

  it("summary message counts both dropped and resolved when kept is empty", () => {
    const anchors = [
      { path: "internal/a.go", line: 10, is_resolved: true },
      { path: "internal/b.go", line: 20, is_resolved: false },
      { path: "internal/b.go", line: 25, is_resolved: true },
    ];
    const result = computeFindings({ findings: sampleFindings, anchors });
    assert.equal(result.kept.length, 0);
    assert.ok(result.message);
    assert.match(result.message!, /3 previously flagged/);
    assert.match(result.message!, /1 still open/);
    assert.match(result.message!, /2 resolved/);
  });
});

describe("buildVerdictComment", () => {
  it("returns PASS verdict with markers when no findings", () => {
    const result = buildVerdictComment({
      findings: [],
      headSha: "abc123def456",
      verdictMarker: "<!-- opencode-pr-review -->",
      headMarker: "<!-- reviewed-head:",
    });
    assert.match(result, /PASS/);
    assert.match(result, /abc123def456/);
    assert.match(result, /opencode-pr-review/);
    assert.match(result, /findings-json-start/);
    assert.match(result, /\[\]/);
  });

  it("returns FAIL verdict with CRITICAL findings", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "CRITICAL", category: "Security", message: "XSS vulnerability" },
    ];
    const result = buildVerdictComment({
      findings,
      headSha: "abc123",
      verdictMarker: "<!-- marker -->",
      headMarker: "<!-- head:",
    });
    assert.match(result, /FAIL/);
    assert.match(result, /1 CRITICAL/);
  });

  it("returns PASS verdict with only LOW findings", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "LOW", category: "Style", message: "formatting" },
    ];
    const result = buildVerdictComment({
      findings,
      headSha: "abc",
      verdictMarker: "<!-- m -->",
      headMarker: "<!-- h:",
    });
    assert.match(result, /PASS/);
    assert.match(result, /0 CRITICAL, 0 HIGH/);
  });

  it("includes findings JSON block", () => {
    const findings = [
      { path: "a.go", line: 5, severity: "HIGH", message: "N+1 query in loop" },
    ];
    const result = buildVerdictComment({
      findings,
      headSha: "sha",
      verdictMarker: "<!-- v -->",
      headMarker: "<!-- h:",
    });
    assert.match(result, /"severity": "HIGH"/);
    assert.match(result, /"path": "a.go"/);
    assert.match(result, /"line": 5/);
    assert.match(result, /findings-json-end/);
  });
});
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFindings, buildVerdictComment, parseDiffPatches, snapToDiffLine } from "./post-findings.js";

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

  it("formats kept findings as severity/category comments", () => {
    const result = computeFindings({ findings: sampleFindings, anchors: [] });
    assert.equal(result.comments.length, 3);
    const firstComment = result.comments[0];
    assert.match(firstComment.body, /\[High\/Performance\]/);
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

  it("snaps off-diff comment lines to nearest hunk endpoint", () => {
    const findings = [{ path: "main.go", line: 8, severity: "High", message: "bug" }];
    const diffLines: Map<string, Array<[number, number]>> = new Map([["main.go", [[12, 18] as [number, number]]]]);
    const result = computeFindings({ findings, anchors: [], diffLines });
    assert.equal(result.comments[0].line, 12);
    assert.equal(result.snappedCount, 1);
  });

  it("does not snap when diffLines is not provided", () => {
    const findings = [{ path: "main.go", line: 8, severity: "High", message: "bug" }];
    const result = computeFindings({ findings, anchors: [] });
    assert.equal(result.comments[0].line, 8);
    assert.equal(result.snappedCount, 0);
  });

  it("reports snappedCount as 0 when no snapping needed", () => {
    const findings = [{ path: "main.go", line: 15, severity: "High", message: "bug" }];
    const diffLines: Map<string, Array<[number, number]>> = new Map([["main.go", [[12, 18] as [number, number]]]]);
    const result = computeFindings({ findings, anchors: [], diffLines });
    assert.equal(result.comments[0].line, 15);
    assert.equal(result.snappedCount, 0);
  });

  it("initializes snappedCount to 0 with empty diffLines", () => {
    const findings = [{ path: "main.go", line: 15, severity: "High", message: "bug" }];
    const result = computeFindings({ findings, anchors: [], diffLines: null });
    assert.equal(result.snappedCount, 0);
    assert.equal(result.comments[0].line, 15);
  });

  it("renders GitHub suggestion block when finding has suggestion_code", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "High", category: "Bug", message: "null deref", suggestion_code: "if x != nil {" },
    ];
    const result = computeFindings({ findings, anchors: [] });
    assert.equal(result.comments.length, 1);
    assert.match(result.comments[0].body, /```suggestion/);
    assert.match(result.comments[0].body, /if x != nil/);
  });

  it("does not render suggestion block when finding has no suggestion_code", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "High", category: "Bug", message: "null deref" },
    ];
    const result = computeFindings({ findings, anchors: [] });
    assert.doesNotMatch(result.comments[0].body, /```suggestion/);
  });
});

describe("parseDiffPatches", () => {
  it("extracts hunk ranges from a standard patch", () => {
    const files = [{
      filename: "main.go",
      patch: "@@ -10,5 +12,7 @@\n context\n+added\n@@ -50,3 +55,5 @@\n ctx\n+added2\n",
    }];
    const map = parseDiffPatches(files);
    assert.deepEqual(map.get("main.go"), [[12, 18], [55, 59]]);
  });

  it("handles hunk with implicit count of 1", () => {
    const files = [{ filename: "a.go", patch: "@@ -5 +6 @@\n+x\n" }];
    const map = parseDiffPatches(files);
    assert.deepEqual(map.get("a.go"), [[6, 6]]);
  });

  it("skips files with no patch (binary or large)", () => {
    const files = [{ filename: "img.png", patch: null }, { filename: "big.go", patch: undefined }];
    const map = parseDiffPatches(files);
    assert.equal(map.size, 0);
  });
});

describe("snapToDiffLine", () => {
  const ranges: Array<[number, number]> = [[12, 18], [55, 59]];

  it("returns the line unchanged when inside a hunk", () => {
    assert.equal(snapToDiffLine(15, ranges), 15);
  });

  it("snaps to nearest hunk start when below all hunks", () => {
    assert.equal(snapToDiffLine(8, ranges), 12);
  });

  it("snaps to nearest hunk endpoint when between hunks", () => {
    assert.equal(snapToDiffLine(30, ranges), 18);
  });

  it("snaps to nearest hunk end when above all hunks", () => {
    assert.equal(snapToDiffLine(80, ranges), 59);
  });

  it("returns line unchanged when ranges is empty", () => {
    assert.equal(snapToDiffLine(50, []), 50);
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
});

describe("buildVerdictComment manifest status", () => {
  it("shows READY when manifestStatus omitted (back-compat)", () => {
    const body = buildVerdictComment({ findings: [], headSha: "abc", verdictMarker: "<!-- v -->", headMarker: "<!-- h:" });
    assert.match(body, /REVIEW\.md: loaded/);
    assert.doesNotMatch(body, /Context status/);
  });

  it("shows fallback reason when provided", () => {
    const body = buildVerdictComment({
      findings: [], headSha: "abc", verdictMarker: "<!-- v -->", headMarker: "<!-- h:",
      manifestStatus: { fallbackReason: "REVIEW.md not found in repo" },
    });
    assert.match(body, /REVIEW\.md: not loaded \(REVIEW\.md not found in repo\)/);
  });

  it("shows READY_WITH_GAPS + missing optional list", () => {
    const body = buildVerdictComment({
      findings: [], headSha: "abc", verdictMarker: "<!-- v -->", headMarker: "<!-- h:",
      manifestStatus: { status: "READY_WITH_GAPS", missingOptional: ["docs/extra.md", "docs/x.md"] },
    });
    assert.match(body, /Context status: READY_WITH_GAPS/);
    assert.match(body, /Missing optional context: docs\/extra\.md, docs\/x\.md/);
  });
});

describe("buildVerdictComment suggestion_code", () => {
  it("includes suggestion_code in verdict JSON suggested_fix field", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "High", category: "Bug", message: "null deref", suggestion_code: "if x != nil {" },
    ];
    const body = buildVerdictComment({
      findings,
      headSha: "abc",
      verdictMarker: "<!-- v -->",
      headMarker: "<!-- h:",
    });
    assert.match(body, /"suggested_fix": "if x != nil {"/);
  });

  it("suggested_fix is empty string when no suggestion_code", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "High", category: "Bug", message: "null deref" },
    ];
    const body = buildVerdictComment({
      findings,
      headSha: "abc",
      verdictMarker: "<!-- v -->",
      headMarker: "<!-- h:",
    });
    assert.match(body, /"suggested_fix": ""/);
  });
});

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
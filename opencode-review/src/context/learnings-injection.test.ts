import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBackground } from "../ocr/build-background.js";
import { buildResolvedDirectives } from "../ocr/resolved-directives.js";
import { computeFindings } from "../ocr/post-findings.js";

function makeThread(overrides: Record<string, unknown>) {
  return {
    path: overrides.path as string || "internal/service.go",
    line: overrides.line as number || 42,
    is_resolved: (overrides.is_resolved as boolean) ?? true,
    is_outdated: (overrides.is_outdated as boolean) ?? false,
    comment_count: overrides.comment_count as number || 3,
    human_bodies: overrides.human_bodies as string[] || ["Fixed per review feedback"],
    latest_author: overrides.latest_author as string | undefined,
    latest_body_excerpt: overrides.latest_body_excerpt as string | undefined,
  };
}

describe("learnings injection integration", () => {
  it("directives: exactly one per resolved non-outdated thread", () => {
    const threads = [
      makeThread({ path: "a.go", line: 10, is_resolved: true, is_outdated: false }),
      makeThread({ path: "b.go", line: 20, is_resolved: true, is_outdated: false }),
      makeThread({ path: "c.go", line: 30, is_resolved: false, is_outdated: false }),
      makeThread({ path: "d.go", line: 40, is_resolved: true, is_outdated: true }),
    ];

    const directives = buildResolvedDirectives(threads);
    assert.equal(directives.length, 2, "2 resolved non-outdated threads");
    assert.equal(directives[0].path, "a.go");
    assert.equal(directives[1].path, "b.go");
  });

  it("background: contains reasoning from resolved threads, excludes outdated", () => {
    const threads = [
      makeThread({ path: "a.go", line: 10, is_resolved: true, is_outdated: false, human_bodies: ["N+1 fix applied"] }),
      makeThread({ path: "b.go", line: 20, is_resolved: true, is_outdated: false, human_bodies: ["Added audit column"] }),
      makeThread({ path: "c.go", line: 30, is_resolved: false, is_outdated: false, human_bodies: ["Still discussing"] }),
      makeThread({ path: "d.go", line: 40, is_resolved: true, is_outdated: true, human_bodies: ["Old fix"] }),
    ];

    const background = buildBackground(threads);
    assert.ok(background.includes("N+1 fix applied"), "contains resolved thread body");
    assert.ok(background.includes("Added audit column"), "contains second resolved thread body");
    assert.ok(!background.includes("Old fix"), "excludes outdated thread body");
    assert.ok(background.length <= 8192, "under budget ceiling");
  });

  it("background: overall output ≤ 8192 bytes", () => {
    const longBody = "x".repeat(100);
    const threads = Array.from({ length: 100 }, (_, i) =>
      makeThread({
        path: `file${i}.go`,
        line: i + 1,
        is_resolved: true,
        is_outdated: false,
        human_bodies: [longBody],
      })
    );

    const background = buildBackground(threads);
    assert.ok(Buffer.byteLength(background) <= 8192, "respects budget limit");
  });

  it("background: handles null/undefined threads gracefully", () => {
    const empty1 = buildBackground(null);
    const empty2 = buildBackground(undefined);
    assert.ok(empty1.length > 0, "returns placeholder, not empty string");
    assert.ok(empty2.length > 0, "returns placeholder, not empty string");
  });

  it("background + serena: serena context prepended before thread content", () => {
    const threads = [
      makeThread({ path: "a.go", line: 10, is_resolved: true, human_bodies: ["Fixed bug"] }),
    ];
    const serenaCtx = "### Serena Context\n- FuncA referenced by: b.go:10\n";

    const background = buildBackground(threads, serenaCtx);
    assert.ok(background.includes("### Serena Context"), "serena context present");
    const serenaPos = background.indexOf("### Serena Context");
    const threadPos = background.indexOf("a.go:10");
    assert.ok(serenaPos < threadPos, "serena context before thread content");
    assert.ok(Buffer.byteLength(background) <= 2000, "under 2000 byte serena budget");
  });

  it("background + serena: thread digest dropped when serena exceeds budget", () => {
    const serenaCtx = "### Serena Context\n" + "x".repeat(1980);
    const threads = [
      makeThread({ path: "a.go", line: 10, is_resolved: true, human_bodies: ["Fixed bug"] }),
    ];

    const background = buildBackground(threads, serenaCtx);
    assert.ok(background.includes("### Serena Context"), "serena preserved");
    assert.ok(!background.includes("a.go:10"), "thread digest dropped when serena fills budget");
  });

  it("consistency: every directive thread has background anchor reference", () => {
    const threads = [
      makeThread({ path: "a.go", line: 10, is_resolved: true, human_bodies: ["Fixed N+1"] }),
      makeThread({ path: "b.go", line: 20, is_resolved: true, human_bodies: ["Added validation"] }),
      makeThread({ path: "c.go", line: 30, is_resolved: false, human_bodies: ["Discussing"] }),
    ];

    const directives = buildResolvedDirectives(threads);
    const background = buildBackground(threads);
    for (const d of directives) {
      assert.ok(background.includes(d.path), `background references ${d.path}`);
    }
  });

  it("post-finding suppression: resolved anchor → resolved bucket, not re-posted", () => {
    const findings = [
      { path: "a.go", line: 10, severity: "HIGH", message: "N+1 query" },
      { path: "b.go", line: 20, severity: "MEDIUM", message: "missing index" },
    ];
    const anchors = [
      { path: "a.go", line: 10, is_resolved: true },
      { path: "b.go", line: 20, is_resolved: false },
    ];

    const result = computeFindings({ findings, anchors });
    assert.equal(result.kept.length, 0, "no kept findings (one resolved, one dropped)");
    assert.equal(result.resolved.length, 1, "one in resolved bucket");
    assert.equal(result.resolved[0].path, "a.go", "resolved finding is a.go");
    assert.equal(result.dropped.length, 1, "one still-open dropped as duplicate");
    assert.equal(result.dropped[0].path, "b.go");
    assert.equal(result.comments.length, 0, "no comments posted");
  });

  it("post-finding suppression: new finding not matched → kept and commented", () => {
    const findings = [
      { path: "c.go", line: 30, severity: "LOW", message: "unused import" },
    ];
    const anchors = [
      { path: "a.go", line: 10, is_resolved: true },
    ];

    const result = computeFindings({ findings, anchors });
    assert.equal(result.kept.length, 1, "new finding kept");
    assert.equal(result.comments.length, 1, "comment posted for new finding");
    assert.equal(result.resolved.length, 0, "nothing resolved");
    assert.equal(result.dropped.length, 0, "nothing dropped");
  });
});

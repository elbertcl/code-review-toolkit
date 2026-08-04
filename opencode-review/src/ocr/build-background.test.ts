import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBackground } from "./build-background.js";

describe("buildBackground", () => {
  it("returns placeholder for empty threads", () => {
    const result = buildBackground([]);
    assert.equal(result, "No prior review threads on this PR.");
  });

  it("returns placeholder for null/undefined threads", () => {
    assert.equal(buildBackground(null), "No prior review threads on this PR.");
    assert.equal(buildBackground(undefined), "No prior review threads on this PR.");
  });

  it("renders a directive and one line per thread", () => {
    const threads = [
      { path: "internal/foo.go", line: 42, latest_author: "alice", latest_body_excerpt: "please rename this" },
    ];
    const result = buildBackground(threads);
    assert.match(result, /Do NOT re-flag/);
    assert.match(result, /internal\/foo\.go:42/);
    assert.match(result, /@alice/);
    assert.match(result, /please rename this/);
  });

  it("caps at 50 threads", () => {
    const threads = Array.from({ length: 60 }, (_, i) => ({
      path: `internal/file${i}.go`,
      line: i,
      latest_author: "user",
      latest_body_excerpt: "note",
    }));
    const result = buildBackground(threads);
    const lines = result.split("\n");
    const itemLines = lines.filter((l) => l.startsWith("- "));
    assert.ok(itemLines.length <= 50);
  });

  it("trims excerpts to ~200 chars", () => {
    const longExcerpt = "x".repeat(500);
    const threads = [
      { path: "internal/foo.go", line: 1, latest_author: "user", latest_body_excerpt: longExcerpt },
    ];
    const result = buildBackground(threads);
    assert.ok(!result.includes(longExcerpt), "long excerpt should be trimmed");
    const match = result.match(/x{100,}/);
    assert.ok(match && match[0].length <= 210, "excerpt should be trimmed");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResolvedDirectives } from "./resolved-directives.js";

interface Thread {
  path: string;
  line: number;
  is_resolved: boolean;
  is_outdated: boolean;
}

describe("buildResolvedDirectives", () => {
  it("returns empty array for empty input", () => {
    assert.deepStrictEqual(buildResolvedDirectives([]), []);
    assert.deepStrictEqual(buildResolvedDirectives(null as unknown as Thread[]), []);
    assert.deepStrictEqual(buildResolvedDirectives(undefined as unknown as Thread[]), []);
  });

  it("returns one directive per resolved thread", () => {
    const threads: Thread[] = [
      { path: "internal/a.go", line: 10, is_resolved: true, is_outdated: false },
      { path: "internal/b.go", line: 20, is_resolved: true, is_outdated: false },
    ];
    const result = buildResolvedDirectives(threads);
    assert.equal(result.length, 2);
    assert.equal(result[0].path, "internal/a.go");
    assert.match(result[0].rule, /near line 10/);
    assert.match(result[0].rule, /Do NOT re-flag/);
    assert.equal(result[1].path, "internal/b.go");
    assert.match(result[1].rule, /near line 20/);
  });

  it("skips unresolved threads", () => {
    const threads: Thread[] = [
      { path: "internal/a.go", line: 10, is_resolved: false, is_outdated: false },
      { path: "internal/b.go", line: 20, is_resolved: true, is_outdated: false },
    ];
    const result = buildResolvedDirectives(threads);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "internal/b.go");
  });

  it("skips outdated threads even if resolved", () => {
    const threads: Thread[] = [
      { path: "internal/a.go", line: 10, is_resolved: true, is_outdated: true },
      { path: "internal/b.go", line: 20, is_resolved: true, is_outdated: false },
    ];
    const result = buildResolvedDirectives(threads);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "internal/b.go");
  });

  it("returns empty when all threads are unresolved", () => {
    const threads: Thread[] = [
      { path: "internal/a.go", line: 10, is_resolved: false, is_outdated: false },
      { path: "internal/b.go", line: 20, is_resolved: false, is_outdated: false },
    ];
    const result = buildResolvedDirectives(threads);
    assert.equal(result.length, 0);
  });
});
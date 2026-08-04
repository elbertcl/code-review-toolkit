import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAnchors } from "./remap-anchors.js";

interface AnchorInput {
  path: string;
  line: number | null;
  is_resolved: boolean;
  is_outdated: boolean;
}

describe("resolveAnchors", () => {
  it("returns empty array for empty input", () => {
    assert.deepStrictEqual(resolveAnchors([]), []);
    assert.deepStrictEqual(resolveAnchors(null as unknown as AnchorInput[]), []);
    assert.deepStrictEqual(resolveAnchors(undefined as unknown as AnchorInput[]), []);
  });

  it("keeps anchors that are not outdated and have a line", () => {
    const anchors: AnchorInput[] = [
      { path: "internal/a.go", line: 10, is_resolved: false, is_outdated: false },
      { path: "internal/b.go", line: 20, is_resolved: true, is_outdated: false },
    ];
    const result = resolveAnchors(anchors);
    assert.equal(result.length, 2);
    assert.deepStrictEqual(result[0], { path: "internal/a.go", line: 10, is_resolved: false });
    assert.deepStrictEqual(result[1], { path: "internal/b.go", line: 20, is_resolved: true });
  });

  it("drops anchors where is_outdated is true", () => {
    const anchors: AnchorInput[] = [
      { path: "internal/a.go", line: 10, is_resolved: false, is_outdated: true },
      { path: "internal/b.go", line: 20, is_resolved: false, is_outdated: false },
    ];
    const result = resolveAnchors(anchors);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "internal/b.go");
  });

  it("drops anchors where line is null", () => {
    const anchors: AnchorInput[] = [
      { path: "internal/a.go", line: null as unknown as number, is_resolved: false, is_outdated: false },
      { path: "internal/b.go", line: 20, is_resolved: false, is_outdated: false },
    ];
    const result = resolveAnchors(anchors);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "internal/b.go");
  });

  it("drops anchors that are both outdated and have null line", () => {
    const anchors: AnchorInput[] = [
      { path: "internal/a.go", line: null as unknown as number, is_resolved: false, is_outdated: true },
      { path: "internal/b.go", line: 20, is_resolved: false, is_outdated: false },
    ];
    const result = resolveAnchors(anchors);
    assert.equal(result.length, 1);
  });

  it("preserves order of kept anchors", () => {
    const anchors: AnchorInput[] = [
      { path: "a.go", line: 1, is_resolved: false, is_outdated: false },
      { path: "b.go", line: 10, is_resolved: false, is_outdated: true },
      { path: "c.go", line: 20, is_resolved: true, is_outdated: false },
      { path: "d.go", line: null as unknown as number, is_resolved: false, is_outdated: false },
      { path: "e.go", line: 30, is_resolved: false, is_outdated: false },
    ];
    const result = resolveAnchors(anchors);
    assert.equal(result.length, 3);
    assert.equal(result[0].path, "a.go");
    assert.equal(result[1].path, "c.go");
    assert.equal(result[2].path, "e.go");
  });
});
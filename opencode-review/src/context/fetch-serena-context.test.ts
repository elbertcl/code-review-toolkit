import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enumerateTargets, formatPointerArtifact } from "./fetch-serena-context.js";

describe("enumerateTargets", () => {
  it("returns all files when under cap", () => {
    const files = ["a.go", "b.go", "c.go"];
    const result = enumerateTargets(files, 10);
    assert.deepStrictEqual(result.files, files);
    assert.equal(result.overflow, false);
  });

  it("caps at the given limit", () => {
    const files = ["a.go", "b.go", "c.go", "d.go", "e.go"];
    const result = enumerateTargets(files, 3);
    assert.deepStrictEqual(result.files, ["a.go", "b.go", "c.go"]);
    assert.equal(result.overflow, true);
  });

  it("returns empty for empty input", () => {
    const result = enumerateTargets([], 5);
    assert.deepStrictEqual(result.files, []);
    assert.equal(result.overflow, false);
  });

  it("returns all when at exact cap", () => {
    const files = ["a.go", "b.go"];
    const result = enumerateTargets(files, 2);
    assert.deepStrictEqual(result.files, files);
    assert.equal(result.overflow, false);
  });

  it("handles null input", () => {
    const result = enumerateTargets(null as unknown as string[], 5);
    assert.deepStrictEqual(result.files, []);
    assert.equal(result.overflow, false);
  });
});

interface SymbolRef {
  symbol: string;
  references: string[];
}

describe("formatPointerArtifact", () => {
  it("formats symbols with references", () => {
    const refs: SymbolRef[] = [
      { symbol: "ProcessSpendingSellerEvents", references: ["spending_event_subscriber.go:92", "creditmanager_test.go:150"] },
    ];
    const result = formatPointerArtifact(refs, 8192);
    assert.match(result, /ProcessSpendingSellerEvents/);
    assert.match(result, /spending_event_subscriber\.go:92/);
    assert.match(result, /referenced by:/);
  });

  it("returns empty string for empty refs", () => {
    assert.equal(formatPointerArtifact([], 1000), "");
    assert.equal(formatPointerArtifact(null as unknown as SymbolRef[], 1000), "");
  });

  it("respects budget limit", () => {
    const refs: SymbolRef[] = Array.from({ length: 50 }, (_, i) => ({
      symbol: `Func${i}`,
      references: [`file${i}.go:${i}`],
    }));
    const result = formatPointerArtifact(refs, 200);
    assert.ok(Buffer.byteLength(result) <= 200);
  });

  it("truncates with marker when over budget", () => {
    const longName = "VeryLongSymbolName".repeat(20);
    const refs: SymbolRef[] = [
      { symbol: longName, references: ["file.go:42"] },
    ];
    const result = formatPointerArtifact(refs, 50);
    assert.ok(result.includes("…[truncated]"));
  });

  it("drops verbose bodies — only pointer lines", () => {
    const refs: SymbolRef[] = [
      { symbol: "MyFunc", references: ["a.go:1", "b.go:2"] },
    ];
    const result = formatPointerArtifact(refs, 8192);
    const lines = result.split("\n").filter(Boolean);
    for (const line of lines) {
      assert.match(line, /^- /, "every line should be a pointer line");
    }
  });
});
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBackground, allocateBudget } from "./build-background.js";
describe("allocateBudget", () => {
    it("returns empty array for empty threads", () => {
        assert.deepStrictEqual(allocateBudget([], 100), []);
    });
    it("distributes budget equally across threads", () => {
        const threads = [
            { path: "a.go", line: 1, human_bodies: ["short"] },
            { path: "b.go", line: 2, human_bodies: ["short"] },
        ];
        const result = allocateBudget(threads, 200);
        assert.equal(result.length, 2);
        assert.ok(Math.abs(result[0] - 100) <= 1);
        assert.ok(Math.abs(result[1] - 100) <= 1);
    });
    it("returns zero allocations when budget is zero", () => {
        const threads = [
            { path: "a.go", line: 1, human_bodies: ["content"] },
        ];
        const result = allocateBudget(threads, 0);
        assert.equal(result[0], 0);
    });
    it("handles single thread getting full budget", () => {
        const threads = [
            { path: "a.go", line: 1, human_bodies: ["content"] },
        ];
        const result = allocateBudget(threads, 500);
        assert.equal(result[0], 500);
    });
});
describe("buildBackground", () => {
    it("returns placeholder for empty threads", () => {
        const result = buildBackground([]);
        assert.equal(result, "No prior review threads on this PR.");
    });
    it("returns placeholder for null/undefined threads", () => {
        assert.equal(buildBackground(null), "No prior review threads on this PR.");
        assert.equal(buildBackground(undefined), "No prior review threads on this PR.");
    });
    it("emits resolved thread with reasoning digest", () => {
        const threads = [
            {
                path: "internal/foo.go", line: 42, is_resolved: true, is_outdated: false,
                comment_count: 2, human_bodies: ["This looks good.", "Agreed, resolving."],
                latest_author: "alice", latest_body_excerpt: "Agreed, resolving.",
            },
        ];
        const result = buildBackground(threads);
        assert.match(result, /Do NOT re-flag/);
        assert.match(result, /internal\/foo\.go:42 \(resolved, 2 comments\)/);
        assert.match(result, /This looks good/);
        assert.match(result, /Agreed, resolving/);
    });
    it("emits unresolved thread without body text", () => {
        const threads = [
            {
                path: "internal/bar.go", line: 10, is_resolved: false, is_outdated: false,
                comment_count: 1, human_bodies: ["Please fix this."],
            },
        ];
        const result = buildBackground(threads);
        assert.match(result, /internal\/bar\.go:10 \(unresolved\)/);
        assert.ok(!result.includes("Please fix this"), "unresolved thread should not include body text");
    });
    it("total output is under 8192 bytes", () => {
        const threads = Array.from({ length: 100 }, (_, i) => ({
            path: `internal/file${i}.go`,
            line: i,
            is_resolved: i % 2 === 0,
            is_outdated: false,
            comment_count: 3,
            human_bodies: ["x".repeat(500)],
        }));
        const result = buildBackground(threads);
        const byteLength = Buffer.byteLength(result);
        assert.ok(byteLength < 8192, `output ${byteLength} bytes exceeds 8192 limit`);
    });
    it("truncates over-budget thread digests with marker", () => {
        const threads = [
            {
                path: "internal/foo.go", line: 1, is_resolved: true, is_outdated: false,
                comment_count: 1, human_bodies: ["x".repeat(10000)],
            },
        ];
        const result = buildBackground(threads);
        assert.match(result, /\u2026\[truncated\]/);
    });
    it("merges serena context with resolved digest under 2000 bytes", () => {
        const serenaContext = "- ProcessSpendingSellerEvents referenced by: subscriber.go:92";
        const threads = [
            {
                path: "internal/foo.go", line: 10, is_resolved: true, is_outdated: false,
                comment_count: 1, human_bodies: ["This was discussed and resolved."],
            },
        ];
        const result = buildBackground(threads, serenaContext);
        assert.ok(result.startsWith(serenaContext), "serena context should come first");
        assert.match(result, /ProcessSpendingSellerEvents/);
        assert.match(result, /This was discussed and resolved/);
        assert.ok(Buffer.byteLength(result) <= 2100, "total should be near or under 2000");
    });
    it("returns only serena context when no threads", () => {
        const serenaContext = "- MyFunc referenced by: a.go:1";
        const result = buildBackground([], serenaContext);
        assert.equal(result, serenaContext);
    });
    it("prioritizes serena context over digest when budget is tight", () => {
        const serenaContext = "x".repeat(1900);
        const threads = [
            {
                path: "internal/foo.go", line: 1, is_resolved: true, is_outdated: false,
                comment_count: 1, human_bodies: ["some discussion"],
            },
        ];
        const result = buildBackground(threads, serenaContext);
        assert.ok(result.includes("x".repeat(100)), "serena context should be preserved");
    });
});
//# sourceMappingURL=build-background.test.js.map
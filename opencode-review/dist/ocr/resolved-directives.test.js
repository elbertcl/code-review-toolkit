import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResolvedDirectives } from "./resolved-directives.js";
describe("buildResolvedDirectives", () => {
    it("returns empty array for empty input", () => {
        assert.deepStrictEqual(buildResolvedDirectives([]), []);
        assert.deepStrictEqual(buildResolvedDirectives(null), []);
        assert.deepStrictEqual(buildResolvedDirectives(undefined), []);
    });
    it("returns one directive per resolved thread", () => {
        const threads = [
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
        const threads = [
            { path: "internal/a.go", line: 10, is_resolved: false, is_outdated: false },
            { path: "internal/b.go", line: 20, is_resolved: true, is_outdated: false },
        ];
        const result = buildResolvedDirectives(threads);
        assert.equal(result.length, 1);
        assert.equal(result[0].path, "internal/b.go");
    });
    it("skips outdated threads even if resolved", () => {
        const threads = [
            { path: "internal/a.go", line: 10, is_resolved: true, is_outdated: true },
            { path: "internal/b.go", line: 20, is_resolved: true, is_outdated: false },
        ];
        const result = buildResolvedDirectives(threads);
        assert.equal(result.length, 1);
        assert.equal(result[0].path, "internal/b.go");
    });
    it("returns empty when all threads are unresolved", () => {
        const threads = [
            { path: "internal/a.go", line: 10, is_resolved: false, is_outdated: false },
            { path: "internal/b.go", line: 20, is_resolved: false, is_outdated: false },
        ];
        const result = buildResolvedDirectives(threads);
        assert.equal(result.length, 0);
    });
});
//# sourceMappingURL=resolved-directives.test.js.map
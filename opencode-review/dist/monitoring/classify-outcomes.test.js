import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyThreads, buildOutcomeSeries, recoverModelFromVerdicts } from "./classify-outcomes.js";
function botThread(path, line, opts = {}) {
    const nodes = [
        { author: { login: "github-actions[bot]" }, body: `**[HIGH]** issue`, path, line, createdAt: "2026-08-21T10:00:00Z" },
    ];
    if (opts.humanReply) {
        nodes.push({ author: { login: "elbertcl" }, body: opts.humanReply, path, line, createdAt: "2026-08-21T11:00:00Z" });
    }
    return { isResolved: opts.resolved ?? false, isOutdated: false, comments: { totalCount: nodes.length, nodes } };
}
function humanThread(path, line) {
    return {
        isResolved: true,
        isOutdated: false,
        comments: {
            totalCount: 1,
            nodes: [{ author: { login: "mariozul" }, body: "this leaks", path, line, createdAt: "2026-08-21T12:00:00Z" }],
        },
    };
}
describe("classifyThreads", () => {
    it("resolved bot thread -> accepted; precision 1", () => {
        const s = classifyThreads([botThread("a.go", 10, { resolved: true })]);
        assert.equal(s.accepted, 1);
        assert.equal(s.precision, 1);
    });
    it("unresolved with human reply -> disputed; precision 0", () => {
        const s = classifyThreads([botThread("a.go", 10, { humanReply: "not valid" })]);
        assert.equal(s.disputed, 1);
        assert.equal(s.precision, 0);
    });
    it("unresolved without reply -> deferred, excluded from precision", () => {
        const s = classifyThreads([botThread("a.go", 10)]);
        assert.equal(s.deferred, 1);
        assert.equal(s.precision, null);
    });
    it("human thread near bot anchor counts as matched for recall", () => {
        const s = classifyThreads([botThread("a.go", 10, { resolved: true }), humanThread("a.go", 12)]);
        assert.equal(s.recall, 1);
    });
    it("human thread far from any bot anchor is unmatched", () => {
        const s = classifyThreads([botThread("a.go", 10, { resolved: true }), humanThread("b.go", 10)]);
        assert.equal(s.recall, 0);
    });
    it("empty threads -> nulls, no crash", () => {
        const s = classifyThreads([]);
        assert.equal(s.botFindings, 0);
        assert.equal(s.precision, null);
        assert.equal(s.recall, null);
    });
    it("severity x outcome matrix populated", () => {
        const s = classifyThreads([botThread("a.go", 10, { resolved: true })]);
        assert.equal(s.severityOutcome["HIGH"]?.accepted, 1);
    });
    it("first response hours computed from reply timestamps", () => {
        const s = classifyThreads([botThread("a.go", 10, { resolved: true, humanReply: "fixed" })]);
        assert.equal(s.avgFirstResponseHours, 1);
    });
});
describe("buildOutcomeSeries", () => {
    it("tags severity x outcome counts and prefixes names", () => {
        const s = classifyThreads([botThread("a.go", 10, { resolved: true }), botThread("a.go", 20, { humanReply: "no" })]);
        const series = buildOutcomeSeries(s, ["repo:o/r"], 1);
        assert.ok(series.every((x) => x.metric.startsWith("code_review_toolkit.")));
        assert.ok(series.every((x) => x.tags.includes("repo:o/r")));
        const findings = series.filter((x) => x.metric === "code_review_toolkit.effectiveness.findings");
        assert.equal(findings.length, 2);
        assert.ok(findings.some((x) => x.tags.includes("severity:HIGH") && x.tags.includes("outcome:accepted")));
        assert.ok(findings.some((x) => x.tags.includes("severity:HIGH") && x.tags.includes("outcome:disputed")));
        assert.ok(series.some((x) => x.metric === "code_review_toolkit.effectiveness.precision_observed"));
    });
});
describe("recoverModelFromVerdicts", () => {
    it("recovers model from the latest verdict comment", () => {
        const comments = [
            { body: "## Review Verdict\n<!-- v -->\n- Model: old/model", created_at: "2026-08-20T00:00:00Z" },
            { body: "## Review Verdict\n<!-- v -->\n- Model: new/model", created_at: "2026-08-21T00:00:00Z" },
        ];
        const r = recoverModelFromVerdicts(comments, "<!-- v -->");
        assert.equal(r.model, "new/model");
        assert.equal(r.verdictAt, "2026-08-21T00:00:00Z");
    });
    it("returns nulls when no verdicts exist", () => {
        const r = recoverModelFromVerdicts([{ body: "hi", created_at: "2026-08-21T00:00:00Z" }], "<!-- v -->");
        assert.equal(r.model, null);
        assert.equal(r.verdictAt, null);
    });
});
//# sourceMappingURL=classify-outcomes.test.js.map
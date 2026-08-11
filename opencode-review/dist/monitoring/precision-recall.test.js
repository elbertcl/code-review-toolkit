import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeObservedPrecision, computeEstimatedRecall } from "./precision-recall.js";
describe("computeObservedPrecision", () => {
    it("returns 2/3 for 2 accepted and 1 disputed", () => {
        const classifications = [
            { outcome: "accepted", finding_id: "1", classification_reason: "resolved without dispute", confidence: "high" },
            { outcome: "disputed", finding_id: "2", classification_reason: "developer said notabug", confidence: "high" },
            { outcome: "accepted", finding_id: "3", classification_reason: "resolved with fix applied", confidence: "high" },
        ];
        const precision = computeObservedPrecision(classifications);
        assert.equal(precision, 2 / 3);
    });
    it("excludes deferred from precision calculation", () => {
        const classifications = [
            { outcome: "accepted", finding_id: "1", classification_reason: "resolved", confidence: "high" },
            { outcome: "deferred", finding_id: "2", classification_reason: "tech debt ticket created", confidence: "medium" },
        ];
        const precision = computeObservedPrecision(classifications);
        assert.equal(precision, 1);
    });
    it("excludes unclassified from precision calculation", () => {
        const classifications = [
            { outcome: "accepted", finding_id: "1", classification_reason: "fixed", confidence: "high" },
            { outcome: "unclassified", finding_id: "2", classification_reason: "no reply yet", confidence: "low" },
            { outcome: "disputed", finding_id: "3", classification_reason: "not a bug", confidence: "high" },
        ];
        const precision = computeObservedPrecision(classifications);
        assert.equal(precision, 0.5);
    });
    it("returns null when all are unclassified", () => {
        const classifications = [
            { outcome: "unclassified", finding_id: "1", classification_reason: "pending", confidence: "low" },
        ];
        const precision = computeObservedPrecision(classifications);
        assert.equal(precision, null);
    });
    it("returns null for empty input", () => {
        assert.equal(computeObservedPrecision([]), null);
    });
});
describe("computeEstimatedRecall", () => {
    it("returns 3/5 for 3 matched AI and 2 unmatched human", () => {
        const recall = computeEstimatedRecall(3, 2);
        assert.equal(recall, 3 / 5);
    });
    it("returns 0 when no AI findings match human findings", () => {
        const recall = computeEstimatedRecall(0, 5);
        assert.equal(recall, 0);
    });
    it("returns 1.0 when all human findings matched by AI", () => {
        const recall = computeEstimatedRecall(5, 0);
        assert.equal(recall, 1.0);
    });
    it("returns null when both are zero", () => {
        const recall = computeEstimatedRecall(0, 0);
        assert.equal(recall, null);
    });
});
//# sourceMappingURL=precision-recall.test.js.map
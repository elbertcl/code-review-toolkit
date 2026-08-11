import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateRows } from "./collect-telemetry.js";
describe("aggregateRows", () => {
    it("computes averages from multiple rows", () => {
        const rows = [
            { pr: 1, sha: "a", cost: { total: 0.05 }, elapsed_ms: 1000, time_to_first_review_ms: 300000, severity_tally: { High: 2, Low: 1 }, suppressed_as_duplicate: 0 },
            { pr: 2, sha: "b", cost: { total: 0.03 }, elapsed_ms: 800, time_to_first_review_ms: 200000, severity_tally: { Medium: 1 }, suppressed_as_duplicate: 1 },
        ];
        const result = aggregateRows(rows);
        assert.equal(result.run_count, 2);
        assert.equal(result.avg_cost, 0.04);
        assert.equal(result.avg_elapsed_ms, 900);
        assert.equal(result.avg_ttfr_ms, 250000);
        assert.equal(result.total_findings_kept, 4);
        assert.equal(result.total_suppressed, 1);
    });
    it("deduplicates: keeps latest per PR", () => {
        const rows = [
            { pr: 1, sha: "a", timestamp: "2024-01-01T00:00:00Z", cost: { total: 0.05 } },
            { pr: 1, sha: "b", timestamp: "2024-01-02T00:00:00Z", cost: { total: 0.02 } },
        ];
        const result = aggregateRows(rows);
        assert.equal(result.run_count, 1);
        assert.equal(result.avg_cost, 0.02, "keeps the latest (cheaper re-review)");
    });
    it("handles empty input", () => {
        const result = aggregateRows([]);
        assert.equal(result.run_count, 0);
        assert.equal(result.avg_cost, 0);
        assert.equal(result.avg_ttfr_ms, 0);
        assert.equal(result.total_findings_kept, 0);
    });
    it("handles rows with null/undefined fields", () => {
        const rows = [
            { pr: 1, sha: "a", cost: null, elapsed_ms: null, time_to_first_review_ms: null },
        ];
        const result = aggregateRows(rows);
        assert.equal(result.avg_cost, 0);
        assert.equal(result.avg_elapsed_ms, 0);
        assert.equal(result.avg_ttfr_ms, 0);
    });
});
//# sourceMappingURL=collect-telemetry.test.js.map
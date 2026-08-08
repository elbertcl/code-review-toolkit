import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCost } from "./compute-cost.js";
describe("computeCost", () => {
    const rates = {
        "deepseek/deepseek-v4-pro": {
            input_per_million: 0.14,
            output_per_million: 0.28,
            cache_read_per_million: 0.014,
        },
    };
    it("returns cost breakdown when rates and model match", () => {
        const cost = computeCost({ input_tokens: 177757, output_tokens: 10296, cache_read_tokens: 126592 }, rates, "deepseek/deepseek-v4-pro");
        assert.ok(cost);
        assert.equal(cost.input, 0.0249);
        assert.equal(cost.output, 0.0029);
        assert.equal(cost.cache_read, 0.0018);
        assert.equal(cost.total, 0.0295);
    });
    it("returns null when rates is undefined", () => {
        const cost = computeCost({ input_tokens: 1000 }, undefined, "deepseek/deepseek-v4-pro");
        assert.equal(cost, null);
    });
    it("returns null when rates is null", () => {
        const cost = computeCost({ input_tokens: 1000 }, null, "deepseek/deepseek-v4-pro");
        assert.equal(cost, null);
    });
    it("returns null when model is not in rate table", () => {
        const cost = computeCost({ input_tokens: 1000 }, rates, "openai/gpt-4");
        assert.equal(cost, null);
    });
    it("returns null when model is undefined", () => {
        const cost = computeCost({ input_tokens: 1000 }, rates, undefined);
        assert.equal(cost, null);
    });
    it("handles partial rate entry — missing output and cache rates default to 0", () => {
        const partialRates = { "deepseek/deepseek-v4-pro": { input_per_million: 0.14 } };
        const cost = computeCost({ input_tokens: 100000, output_tokens: 50000, cache_read_tokens: 20000 }, partialRates, "deepseek/deepseek-v4-pro");
        assert.ok(cost);
        assert.equal(cost.input, 0.014);
        assert.equal(cost.output, 0);
        assert.equal(cost.cache_read, 0);
        assert.equal(cost.total, 0.014);
    });
    it("returns all-zero breakdown when tokens are 0 (rates still present)", () => {
        const cost = computeCost({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }, rates, "deepseek/deepseek-v4-pro");
        assert.ok(cost);
        assert.equal(cost.input, 0);
        assert.equal(cost.output, 0);
        assert.equal(cost.cache_read, 0);
        assert.equal(cost.total, 0);
    });
    it("handles undefined token fields as 0", () => {
        const cost = computeCost({}, rates, "deepseek/deepseek-v4-pro");
        assert.ok(cost);
        assert.equal(cost.total, 0);
    });
});
//# sourceMappingURL=compute-cost.test.js.map
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOtlpRequest, buildResourceAttributes, isRetryableOtlpStatus, DEFAULT_OTLP_ENDPOINT, } from "./otlp.js";
describe("buildOtlpRequest", () => {
    it("wraps metrics in a valid ExportMetricsServiceRequest shape", () => {
        const body = buildOtlpRequest([
            { name: "code_review_toolkit.tokens.input", value: 1234, attributes: { repo: "o/r", model: "m1" } },
            { name: "code_review_toolkit.elapsed_ms", value: 60000 },
        ], undefined, 1_700_000_000_000);
        assert.equal(body.resourceMetrics.length, 1);
        const rm = body.resourceMetrics[0];
        assert.ok(rm.resource.attributes.some((a) => a.key === "service.name" && a.value.stringValue === "code-review-toolkit"));
        assert.equal(rm.scopeMetrics.length, 1);
        assert.equal(rm.scopeMetrics[0].scope.name, "code-review-toolkit");
        const [first, second] = rm.scopeMetrics[0].metrics;
        assert.equal(first.name, "code_review_toolkit.tokens.input");
        assert.equal(first.gauge.dataPoints[0].asDouble, 1234);
        assert.equal(first.gauge.dataPoints[0].timeUnixNano, "1700000000000000000");
        const attrs = Object.fromEntries((first.gauge.dataPoints[0].attributes ?? []).map((a) => [a.key, a.value.stringValue]));
        assert.equal(attrs.repo, "o/r");
        assert.equal(attrs.model, "m1");
        // metrics without attributes carry no attributes array
        assert.equal(second.gauge.dataPoints[0].attributes, undefined);
    });
    it("applies extra resource attributes alongside service.name", () => {
        const body = buildOtlpRequest([{ name: "m", value: 1 }], { "service.version": "4.3.6" }, 0);
        const attrs = Object.fromEntries(body.resourceMetrics[0].resource.attributes.map((a) => [a.key, a.value.stringValue]));
        assert.equal(attrs["service.name"], "code-review-toolkit");
        assert.equal(attrs["service.version"], "4.3.6");
    });
});
describe("isRetryableOtlpStatus", () => {
    it("classifies per the OTLP/HTTP spec", () => {
        for (const retryable of [429, 502, 503, 504])
            assert.ok(isRetryableOtlpStatus(retryable), `${retryable} retryable`);
        for (const fatal of [400, 401, 403, 404, 413, 500])
            assert.ok(!isRetryableOtlpStatus(fatal), `${fatal} not retryable`);
    });
});
describe("endpoint default", () => {
    it("points at the self-owned astronauts dev collector", () => {
        assert.equal(DEFAULT_OTLP_ENDPOINT, "https://otlp-dev.astronauts.id/v1/metrics");
    });
});
describe("buildResourceAttributes", () => {
    it("always includes service.name and cannot be overridden by extras", () => {
        const attrs = Object.fromEntries(buildResourceAttributes({ "service.name": "evil" }).map((a) => [a.key, a.value.stringValue]));
        assert.equal(attrs["service.name"], "code-review-toolkit");
    });
});
//# sourceMappingURL=otlp.test.js.map
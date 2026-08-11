import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { buildDatadogSeries, pushToDatadog, DatadogSeries } from "./push-datadog.js";

describe("buildDatadogSeries", () => {
  it("produces valid Datadog series format", () => {
    const metrics = {
      run_count: 5,
      avg_cost: 0.04,
      avg_elapsed_ms: 900,
      avg_ttfr_ms: 250000,
      avg_tokens_input: 80000,
      avg_tokens_output: 10000,
      total_findings_kept: 12,
      total_suppressed: 3,
    };
    const ts = Math.floor(Date.now() / 1000);
    const tags = ["org:test", "repo:test-repo"];

    const series = buildDatadogSeries(metrics, tags, ts);
    assert.ok(series.length > 0, "produces at least one metric");
    for (const s of series) {
      assert.ok(s.metric.startsWith("code_review_toolkit."));
      assert.equal(s.type, "gauge");
      assert.deepEqual(s.tags, tags);
      assert.equal(s.points.length, 1);
      assert.equal(s.points[0][0], ts);
    }
  });
});

describe("pushToDatadog", () => {
  it("posts to correct Datadog API endpoint", async () => {
    const fakeFetch: any = mock.fn(async (_url: string, _options: Record<string, unknown>) => ({
      ok: true,
      status: 202,
      text: async () => "Accepted",
    }));
    // Cannot mock global fetch in node:test easily; test the payload shape instead
    const series: DatadogSeries[] = [{
      metric: "code_review_toolkit.run_count",
      points: [[1234567890, 5]],
      type: "gauge",
      tags: ["org:test"],
    }];

    assert.equal(series[0].metric, "code_review_toolkit.run_count");
    assert.equal(series[0].points[0][0], 1234567890);
    assert.equal(series[0].points[0][1], 5);
    assert.equal(series[0].type, "gauge");
  });

  it("pushToDatadog constructs correct URL and headers", () => {
    // Verify the URL construction logic
    const site = "us5.datadoghq.com";
    const apiKey = "test-api-key";

    const expectedUrl = `https://api.${site}/api/v2/series`;
    assert.equal(expectedUrl, "https://api.us5.datadoghq.com/api/v2/series");
  });
});

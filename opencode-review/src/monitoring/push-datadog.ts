import type { AggregatedMetrics } from "./collect-telemetry.js";

export interface DatadogSeries {
  metric: string;
  points: Array<[number, number]>;
  type: string;
  tags: string[];
}

export function buildDatadogSeries(metrics: AggregatedMetrics, tags: string[], ts: number): DatadogSeries[] {
  return Object.entries(metrics)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => ({
      metric: `code_review_toolkit.${key}`,
      points: [[ts, value as number]],
      type: "gauge",
      tags,
    }));
}

export async function pushToDatadog(
  apiKey: string, site: string, series: DatadogSeries[]
): Promise<{ ok: boolean; status: number; error?: string }> {
  const resp = await fetch(`https://api.${site}/api/v2/series`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "DD-API-KEY": apiKey },
    body: JSON.stringify({ series }),
  });
  return { ok: resp.ok, status: resp.status, error: resp.ok ? undefined : await resp.text() };
}

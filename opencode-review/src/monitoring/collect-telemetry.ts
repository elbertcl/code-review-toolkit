export interface MeasurementRow {
  lane?: string;
  pr: number;
  sha: string;
  timestamp?: string;
  tokens?: Record<string, number | string>;
  cost?: { total?: number; input?: number; output?: number; cache_read?: number } | null;
  elapsed_ms?: number | null;
  time_to_first_review_ms?: number | null;
  severity_tally?: Record<string, number>;
  suppressed_as_duplicate?: number;
}

export interface AggregatedMetrics {
  run_count: number;
  avg_cost: number;
  avg_tokens_input: number;
  avg_tokens_output: number;
  avg_elapsed_ms: number;
  avg_ttfr_ms: number;
  total_findings_kept: number;
  total_suppressed: number;
  [key: string]: number;
}

export function aggregateRows(rows: MeasurementRow[]): AggregatedMetrics {
  const latestByPr = new Map<number, MeasurementRow>();
  for (const r of rows) {
    const existing = latestByPr.get(r.pr);
    const rTs = r.timestamp ? new Date(r.timestamp).getTime() : 0;
    if (!existing) {
      latestByPr.set(r.pr, r);
    } else {
      const eTs = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
      if (rTs > eTs) latestByPr.set(r.pr, r);
    }
  }
  const deduped = [...latestByPr.values()];
  const n = deduped.length || 1;

  const sum = (sel: (r: MeasurementRow) => number | null | undefined): number =>
    deduped.reduce((acc, r) => acc + (sel(r) ?? 0), 0);

  return {
    run_count: deduped.length,
    avg_cost: sum((r) => r.cost?.total ?? null) / n,
    avg_tokens_input: sum((r) => (r.tokens ? Number(r.tokens.input) || 0 : 0)) / n,
    avg_tokens_output: sum((r) => (r.tokens ? Number(r.tokens.output) || 0 : 0)) / n,
    avg_elapsed_ms: sum((r) => r.elapsed_ms ?? null) / n,
    avg_ttfr_ms: sum((r) => r.time_to_first_review_ms ?? null) / n,
    total_findings_kept: sum((r) => {
      const t = r.severity_tally;
      return t ? Object.values(t).reduce((a: number, b: number) => a + b, 0) : 0;
    }),
    total_suppressed: sum((r) => r.suppressed_as_duplicate ?? 0),
  };
}

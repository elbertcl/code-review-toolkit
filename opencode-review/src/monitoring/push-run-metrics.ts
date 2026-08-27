import { readFileSync } from "node:fs";
import { buildOtlpRequest, pushToOtlp, readOtlpConfigFromEnv, type OtelMetric } from "./otlp.js";

export interface RunMetricRow {
  pr: number;
  repo?: string | null;
  model?: string | null;
  org_profiles?: string | null;
  mode?: string | null;
  verdict?: string | null;
  tokens?: Record<string, number | string> | null;
  cost?: { total?: number } | null;
  elapsed_ms?: number | null;
  tool_calls?: number | Record<string, number> | null;
  serena?: { status?: string } | null;
  context?: {
    rules_compiled?: number;
    conditional_contexts_matched?: string[];
    directives_applied?: number;
    rule_json_bytes?: number;
    background_bytes?: number;
    serena_pointer_chars?: number;
    manifest_status?: string;
    fallback_reason?: string;
    rule_citation_rate?: number | null;
  } | null;
}

export function buildRunMetrics(row: RunMetricRow): OtelMetric[] {
  const attributes: Record<string, string> = {};
  if (row.repo) attributes.repo = row.repo;
  if (row.model) attributes.model = row.model;
  if (row.org_profiles) {
    for (const p of row.org_profiles.split(",")) {
      const t = p.trim();
      if (t && !attributes[`org_profile_${t.replace(/[/:]/g, "_")}`]) {
        attributes[`org_profile_${t.replace(/[/:]/g, "_")}`] = t;
      }
    }
  }
  if (row.mode) attributes.mode = row.mode;
  if (row.verdict) attributes.verdict = row.verdict;

  const points: Array<[string, number]> = [];
  const t = row.tokens ?? {};
  if (Number(t.input)) points.push(["tokens.input", Number(t.input)]);
  if (Number(t.output)) points.push(["tokens.output", Number(t.output)]);
  if (Number(t.cache_read)) points.push(["tokens.cache_read", Number(t.cache_read)]);
  if (row.cost?.total != null) points.push(["cost.total", row.cost.total]);
  if (row.elapsed_ms != null) points.push(["elapsed_ms", row.elapsed_ms]);
  if (typeof row.tool_calls === "number") points.push(["tool_calls", row.tool_calls]);

  const ctx = row.context ?? {};
  if (ctx.rules_compiled != null) points.push(["context.rules_compiled", ctx.rules_compiled]);
  if (ctx.conditional_contexts_matched) points.push(["context.conditional_contexts_matched", ctx.conditional_contexts_matched.length]);
  if (ctx.directives_applied != null) points.push(["context.directives_applied", ctx.directives_applied]);
  if (ctx.rule_json_bytes != null) points.push(["context.rule_json_bytes", ctx.rule_json_bytes]);
  if (ctx.background_bytes != null) points.push(["context.background_bytes", ctx.background_bytes]);
  if (ctx.serena_pointer_chars != null) points.push(["context.serena_pointer_chars", ctx.serena_pointer_chars]);
  if (ctx.rule_citation_rate != null) points.push(["context.rule_citation_rate", ctx.rule_citation_rate]);
  if (ctx.manifest_status === "BLOCKED") points.push(["reliability.manifest_status_blocked", 1]);
  else if (ctx.manifest_status === "READY_WITH_GAPS") points.push(["reliability.manifest_status_gaps", 1]);
  if (ctx.fallback_reason) points.push(["reliability.fallback", 1]);
  if (row.serena?.status === "unavailable") points.push(["reliability.serena_fail_open", 1]);

  return points.map(([name, value]) => ({
    name: `code_review_toolkit.${name}`,
    value,
    attributes,
  }));
}

export async function pushRunMetrics(
  config: { endpoint: string; authHeader: string; timeoutMs: number },
  row: RunMetricRow,
): Promise<{ ok: boolean; status: number; error?: string; partial?: { rejectedDataPoints: number; errorMessage?: string } }> {
  const metrics = buildRunMetrics(row);
  if (metrics.length === 0) return { ok: true, status: 0 };
  const body = buildOtlpRequest(metrics, undefined, Date.now());
  const result = await pushToOtlp(config.endpoint, config.authHeader, body, config.timeoutMs);
  return { ok: result.ok, status: result.status, error: result.error, partial: result.partial };
}

if (process.argv[1] && process.argv[1].endsWith("push-run-metrics.js")) {
  const rowPath = process.argv[2];
  if (!rowPath) {
    process.stderr.write("Usage: node push-run-metrics.js <review-run.json>\n");
    process.exit(1);
  }
  const config = readOtlpConfigFromEnv();
  if (!config) {
    process.stdout.write("metrics: OTEL_EXPORTER_OTLP_AUTH not set — skipping push\n");
    process.exit(0);
  }
  try {
    const row = JSON.parse(readFileSync(rowPath, "utf8")) as RunMetricRow;
    const result = await pushRunMetrics(config, row);
    if (!result.ok) process.stdout.write(`metrics: push failed (HTTP ${result.status}${result.error ? `: ${result.error.slice(0, 200)}` : ""})\n`);
    else if (result.partial) process.stdout.write(`metrics: partial success (${result.partial.rejectedDataPoints} rejected: ${result.partial.errorMessage ?? "no reason"})\n`);
    else process.stdout.write("metrics: pushed\n");
  } catch (error) {
    process.stdout.write(`metrics: skipped (${(error as Error).message})\n`);
  }
  process.exit(0); // best-effort: never fail the workflow
}

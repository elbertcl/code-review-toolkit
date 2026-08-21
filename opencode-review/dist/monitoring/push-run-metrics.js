import { readFileSync } from "node:fs";
import { pushToDatadog } from "./push-datadog.js";
export function buildRunSeries(row, ts) {
    const tags = [];
    if (row.repo)
        tags.push(`repo:${row.repo}`);
    if (row.model)
        tags.push(`model:${row.model}`);
    if (row.org_profiles) {
        for (const p of row.org_profiles.split(",")) {
            const t = p.trim();
            if (t)
                tags.push(`org_profile:${t}`);
        }
    }
    if (row.mode)
        tags.push(`mode:${row.mode}`);
    if (row.verdict)
        tags.push(`verdict:${row.verdict}`);
    const points = [];
    const t = row.tokens ?? {};
    if (Number(t.input))
        points.push(["tokens.input", Number(t.input)]);
    if (Number(t.output))
        points.push(["tokens.output", Number(t.output)]);
    if (Number(t.cache_read))
        points.push(["tokens.cache_read", Number(t.cache_read)]);
    if (row.cost?.total != null)
        points.push(["cost.total", row.cost.total]);
    if (row.elapsed_ms != null)
        points.push(["elapsed_ms", row.elapsed_ms]);
    if (typeof row.tool_calls === "number")
        points.push(["tool_calls", row.tool_calls]);
    const ctx = row.context ?? {};
    if (ctx.rules_compiled != null)
        points.push(["context.rules_compiled", ctx.rules_compiled]);
    if (ctx.conditional_contexts_matched)
        points.push(["context.conditional_contexts_matched", ctx.conditional_contexts_matched.length]);
    if (ctx.directives_applied != null)
        points.push(["context.directives_applied", ctx.directives_applied]);
    if (ctx.rule_json_bytes != null)
        points.push(["context.rule_json_bytes", ctx.rule_json_bytes]);
    if (ctx.background_bytes != null)
        points.push(["context.background_bytes", ctx.background_bytes]);
    if (ctx.serena_pointer_chars != null)
        points.push(["context.serena_pointer_chars", ctx.serena_pointer_chars]);
    if (ctx.rule_citation_rate != null)
        points.push(["context.rule_citation_rate", ctx.rule_citation_rate]);
    if (ctx.manifest_status === "BLOCKED")
        points.push(["reliability.manifest_status_blocked", 1]);
    else if (ctx.manifest_status === "READY_WITH_GAPS")
        points.push(["reliability.manifest_status_gaps", 1]);
    if (ctx.fallback_reason)
        points.push(["reliability.fallback", 1]);
    if (row.serena?.status === "unavailable")
        points.push(["reliability.serena_fail_open", 1]);
    return points.map(([name, value]) => ({
        metric: `code_review_toolkit.${name}`,
        points: [[ts, value]],
        type: "gauge",
        tags,
    }));
}
export async function pushRunMetrics(apiKey, site, row) {
    const series = buildRunSeries(row, Math.floor(Date.now() / 1000));
    if (series.length === 0)
        return { ok: true };
    const result = await pushToDatadog(apiKey, site, series);
    return { ok: result.ok, error: result.error };
}
if (process.argv[1] && process.argv[1].endsWith("push-run-metrics.js")) {
    const rowPath = process.argv[2];
    const apiKey = process.env.DD_API_KEY || "";
    if (!rowPath) {
        process.stderr.write("Usage: node push-run-metrics.js <review-run.json>\n");
        process.exit(1);
    }
    if (!apiKey) {
        process.stdout.write("metrics: DD_API_KEY not set — skipping push\n");
        process.exit(0);
    }
    try {
        const row = JSON.parse(readFileSync(rowPath, "utf8"));
        const result = await pushRunMetrics(apiKey, process.env.DD_SITE || "datadoghq.com", row);
        if (!result.ok)
            process.stdout.write(`metrics: push failed (${result.error})\n`);
        else
            process.stdout.write("metrics: pushed\n");
    }
    catch (error) {
        process.stdout.write(`metrics: skipped (${error.message})\n`);
    }
    process.exit(0); // best-effort: never fail the workflow
}
//# sourceMappingURL=push-run-metrics.js.map
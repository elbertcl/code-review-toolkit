export function aggregateRows(rows) {
    const latestByPr = new Map();
    for (const r of rows) {
        const existing = latestByPr.get(r.pr);
        const rTs = r.timestamp ? new Date(r.timestamp).getTime() : 0;
        if (!existing) {
            latestByPr.set(r.pr, r);
        }
        else {
            const eTs = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
            if (rTs > eTs)
                latestByPr.set(r.pr, r);
        }
    }
    const deduped = [...latestByPr.values()];
    const n = deduped.length || 1;
    const sum = (sel) => deduped.reduce((acc, r) => acc + (sel(r) ?? 0), 0);
    return {
        run_count: deduped.length,
        avg_cost: sum((r) => r.cost?.total ?? null) / n,
        avg_tokens_input: sum((r) => (r.tokens ? Number(r.tokens.input) || 0 : 0)) / n,
        avg_tokens_output: sum((r) => (r.tokens ? Number(r.tokens.output) || 0 : 0)) / n,
        avg_elapsed_ms: sum((r) => r.elapsed_ms ?? null) / n,
        avg_ttfr_ms: sum((r) => r.time_to_first_review_ms ?? null) / n,
        total_findings_kept: sum((r) => {
            const t = r.severity_tally;
            return t ? Object.values(t).reduce((a, b) => a + b, 0) : 0;
        }),
        total_suppressed: sum((r) => r.suppressed_as_duplicate ?? 0),
    };
}
//# sourceMappingURL=collect-telemetry.js.map
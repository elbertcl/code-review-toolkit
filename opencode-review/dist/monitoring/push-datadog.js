export function buildDatadogSeries(metrics, tags, ts) {
    return Object.entries(metrics)
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => ({
        metric: `code_review_toolkit.${key}`,
        points: [[ts, value]],
        type: "gauge",
        tags,
    }));
}
export async function pushToDatadog(apiKey, site, series) {
    const resp = await fetch(`https://api.${site}/api/v2/series`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "DD-API-KEY": apiKey },
        body: JSON.stringify({ series }),
    });
    return { ok: resp.ok, status: resp.status, error: resp.ok ? undefined : await resp.text() };
}
//# sourceMappingURL=push-datadog.js.map
export function buildMeasurementRow({ verdict, findings, suppressed, tokens, prNumber, sha, cost, elapsedMs, toolCalls }) {
    const severityTally = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
    for (const finding of (findings ?? [])) {
        const sev = finding.severity ?? "Info";
        if (severityTally[sev] !== undefined)
            severityTally[sev] += 1;
        else
            severityTally[sev] = 1;
    }
    return {
        lane: "ocr",
        timestamp: new Date().toISOString(),
        pr: prNumber,
        sha,
        context: { verdict },
        severity_tally: severityTally,
        suppressed_as_duplicate: suppressed ?? 0,
        tokens: { ...tokens, source: "ocr_native" },
        cost,
        elapsed_ms: elapsedMs,
        tool_calls: toolCalls ?? null,
    };
}
//# sourceMappingURL=append-measurement.js.map
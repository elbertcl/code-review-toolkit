const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
export function parseDiffPatches(files) {
    const map = new Map();
    for (const file of files) {
        if (!file.patch)
            continue;
        const ranges = [];
        for (const line of file.patch.split("\n")) {
            const m = line.match(HUNK_RE);
            if (!m)
                continue;
            const start = Number(m[1]);
            const count = m[2] != null ? Number(m[2]) : 1;
            ranges.push([start, start + count - 1]);
        }
        if (ranges.length > 0)
            map.set(file.filename, ranges);
    }
    return map;
}
export function snapToDiffLine(line, ranges) {
    for (const [s, e] of ranges) {
        if (line >= s && line <= e)
            return line;
    }
    let best = null;
    let bestDist = Infinity;
    for (const [s, e] of ranges) {
        const d = Math.min(Math.abs(line - s), Math.abs(line - e));
        if (d < bestDist) {
            bestDist = d;
            best = [s, e];
        }
    }
    if (!best)
        return line;
    return Math.abs(line - best[0]) <= Math.abs(line - best[1]) ? best[0] : best[1];
}
export function computeFindings({ findings, anchors, diffLines }) {
    const f = findings ?? [];
    const a = anchors ?? [];
    const isMatch = (finding, anchor) => {
        if (finding.path !== anchor.path)
            return false;
        if (finding.line != null && finding.line === anchor.line)
            return true;
        if (finding.line == null && finding.end_line != null && finding.end_line === anchor.line)
            return true;
        return false;
    };
    const dropped = [];
    const resolved = [];
    const kept = [];
    for (const finding of f) {
        const matchedAnchor = a.find((anchor) => isMatch(finding, anchor));
        if (!matchedAnchor) {
            kept.push(finding);
        }
        else if (matchedAnchor.is_resolved) {
            resolved.push(finding);
        }
        else {
            dropped.push(finding);
        }
    }
    let snappedCount = 0;
    const comments = kept.map((finding) => {
        const sevCat = `${finding.severity ?? "Info"}/${finding.category ?? "General"}`;
        let line = finding.line ?? finding.start_line ?? finding.end_line ?? 0;
        if (diffLines && line > 0) {
            const ranges = diffLines.get(finding.path);
            if (ranges) {
                const snapped = snapToDiffLine(line, ranges);
                if (snapped !== line)
                    snappedCount++;
                line = snapped;
            }
        }
        return {
            path: finding.path,
            line,
            body: `**[${sevCat}]** ${finding.message || finding.content || ""}`,
        };
    });
    let message = null;
    if (kept.length === 0) {
        const total = dropped.length + resolved.length;
        if (total > 0) {
            message = `No new findings. ${total} previously flagged issue${total !== 1 ? "s" : ""} (${dropped.length} still open, ${resolved.length} resolved) suppressed as duplicate.`;
        }
    }
    return { kept, dropped, resolved, comments, message, verdictComment: null, snappedCount };
}
function formatTokenCount(n) {
    if (n == null || n === 0)
        return "0";
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${Math.round(n / 1_000)}K`;
    return String(n);
}
function formatElapsed(ms) {
    if (ms == null)
        return null;
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m${s}s`;
}
function buildFooter(measurement) {
    const parts = [];
    const totalTokens = measurement.tokens.total;
    const inputTokens = measurement.tokens.input;
    const outputTokens = measurement.tokens.output;
    const cacheTokens = measurement.tokens.cache_read;
    const hasTokens = (totalTokens ?? 0) > 0 || (inputTokens ?? 0) > 0 || (outputTokens ?? 0) > 0;
    if (hasTokens) {
        const tokenStr = formatTokenCount(totalTokens);
        const breakdown = `${formatTokenCount(inputTokens)} input \u00b7 ${formatTokenCount(outputTokens)} output${cacheTokens ? ` \u00b7 ${formatTokenCount(cacheTokens)} cache` : ""}`;
        parts.push(`${tokenStr} tokens (${breakdown})`);
    }
    else {
        parts.push("tokens unavailable");
    }
    const elapsed = formatElapsed(measurement.elapsedMs);
    if (elapsed)
        parts.push(elapsed);
    if (measurement.cost) {
        parts.push(`$${measurement.cost.total}`);
    }
    if (measurement.toolCalls) {
        const total = measurement.toolCalls.total;
        if (total != null && total > 0) {
            parts.push(`${total} tool calls`);
        }
    }
    return `\n---\n**Run:** ${parts.join(" \u00b7 ")}`;
}
export function buildVerdictComment({ findings, headSha, verdictMarker, headMarker, serenaStatus, manifestFallbackReason, manifestStatus, measurement }) {
    const criticalCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "CRITICAL").length;
    const highCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "HIGH").length;
    const mediumCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "MEDIUM").length;
    const lowCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "LOW").length;
    const total = findings.length;
    const verdict = criticalCount > 0 || highCount > 0 ? "FAIL" : "PASS";
    const items = findings.map((f) => ({
        severity: f.severity ?? "INFO",
        path: f.path,
        line: f.line ?? f.start_line ?? f.end_line ?? 0,
        title: (f.message || f.content || "").split(".")[0] || f.message || f.content || "",
        body: f.message || f.content || "",
        suggested_fix: "",
    }));
    const serenaLabel = serenaStatus === "available" ? "available" : "not available";
    const reason = manifestStatus?.fallbackReason ?? manifestFallbackReason ?? "";
    const reviewMdLabel = reason ? `not loaded (${reason})` : "loaded";
    const contextLines = [`- Serena: ${serenaLabel}`, `- REVIEW.md: ${reviewMdLabel}`];
    if (manifestStatus?.status) {
        contextLines.push(`- Context status: ${manifestStatus.status}`);
    }
    if (manifestStatus?.missingOptional && manifestStatus.missingOptional.length > 0) {
        contextLines.push(`- Missing optional context: ${manifestStatus.missingOptional.join(", ")}`);
    }
    const footer = measurement ? buildFooter(measurement) : "";
    return `## Review Verdict

**Context:**
${contextLines.join("\n")}

**Verdict: ${verdict}** — ${total} finding${total !== 1 ? "s" : ""} (${criticalCount} CRITICAL, ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW)

${headMarker} ${headSha} -->
${verdictMarker}
<!-- findings-json-start
${JSON.stringify(items, null, 2)}
findings-json-end -->${footer}`;
}
//# sourceMappingURL=post-findings.js.map
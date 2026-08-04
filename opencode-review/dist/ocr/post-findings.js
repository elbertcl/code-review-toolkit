export function computeFindings({ findings, anchors }) {
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
    const comments = kept.map((finding) => {
        const sevCat = `${finding.severity ?? "Info"}/${finding.category ?? "General"}`;
        const line = finding.line ?? finding.start_line ?? finding.end_line ?? 0;
        return {
            path: finding.path,
            line,
            body: `**[OCR POC][${sevCat}]** ${finding.message}`,
        };
    });
    let message = null;
    if (kept.length === 0) {
        const total = dropped.length + resolved.length;
        if (total > 0) {
            message = `No new findings. ${total} previously flagged issue${total !== 1 ? "s" : ""} (${dropped.length} still open, ${resolved.length} resolved) suppressed as duplicate.`;
        }
    }
    return { kept, dropped, resolved, comments, message };
}
//# sourceMappingURL=post-findings.js.map
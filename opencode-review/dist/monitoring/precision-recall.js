export function computeObservedPrecision(classifications) {
    const scored = classifications.filter((c) => c.outcome === "accepted" || c.outcome === "disputed");
    if (scored.length === 0)
        return null;
    const accepted = scored.filter((c) => c.outcome === "accepted").length;
    return accepted / scored.length;
}
export function computeEstimatedRecall(matchedAiFindings, unmatchedHumanFindings) {
    const denominator = matchedAiFindings + unmatchedHumanFindings;
    if (denominator === 0)
        return null;
    return matchedAiFindings / denominator;
}
//# sourceMappingURL=precision-recall.js.map
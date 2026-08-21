const ANCHOR_WINDOW = 5;
export function matchFindings(expected, actual) {
    const taken = new Set();
    const matched = [];
    const unmatchedExpected = [];
    for (const e of expected) {
        const idx = actual.findIndex((a, i) => !taken.has(i) && a.path === e.path && Math.abs(a.line - e.line_approx) <= ANCHOR_WINDOW);
        if (idx >= 0) {
            taken.add(idx);
            matched.push({ expected: e, actual: actual[idx] });
        }
        else {
            unmatchedExpected.push(e);
        }
    }
    const unmatchedActual = actual.filter((_, i) => !taken.has(i));
    return { matched, unmatchedExpected, unmatchedActual };
}
export function evaluateCell(expected, actual) {
    const { matched } = matchFindings(expected, actual);
    const precision = actual.length > 0 ? matched.length / actual.length : null;
    const recall = expected.length > 0 ? matched.length / expected.length : null;
    const severityMatches = matched.filter((m) => m.expected.severity.toUpperCase() === m.actual.severity.toUpperCase());
    const severity_match_rate = matched.length > 0 ? severityMatches.length / matched.length : null;
    const ruleExpected = matched.filter((m) => m.expected.rule_id);
    const ruleCited = ruleExpected.filter((m) => m.expected.rule_id && m.actual.body.toUpperCase().includes(m.expected.rule_id.toUpperCase()));
    const rule_citation_rate = ruleExpected.length > 0 ? ruleCited.length / ruleExpected.length : null;
    return { precision, recall, severity_match_rate, rule_citation_rate };
}
//# sourceMappingURL=evaluate.js.map
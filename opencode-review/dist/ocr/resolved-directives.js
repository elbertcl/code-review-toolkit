export function buildResolvedDirectives(threads) {
    if (!Array.isArray(threads))
        return [];
    const rules = [];
    for (const t of threads) {
        if (!t.is_resolved || t.is_outdated)
            continue;
        rules.push({
            path: t.path,
            rule: `A prior review finding near line ${t.line} was resolved/discussed on this PR. Do NOT re-flag unless the diff introduces a new, distinct issue at this anchor.`,
        });
    }
    return rules;
}
//# sourceMappingURL=resolved-directives.js.map
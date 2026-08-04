export function resolveAnchors(anchors) {
    if (!Array.isArray(anchors))
        return [];
    const resolved = [];
    for (const a of anchors) {
        if (a.is_outdated)
            continue;
        if (a.line == null)
            continue;
        resolved.push({ path: a.path, line: a.line, is_resolved: a.is_resolved });
    }
    return resolved;
}
//# sourceMappingURL=remap-anchors.js.map
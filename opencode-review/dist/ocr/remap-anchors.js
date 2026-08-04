import { readFileSync, writeFileSync } from "node:fs";
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
if (process.argv[1] && process.argv[1].endsWith("remap-anchors.js")) {
    const inputPath = process.argv[2];
    const outputPath = process.argv[3];
    if (!inputPath || !outputPath) {
        process.stderr.write("Usage: node remap-anchors.js <anchors.json> <output.json>\n");
        process.exit(1);
    }
    const anchors = JSON.parse(readFileSync(inputPath, "utf8"));
    const remapped = resolveAnchors(anchors);
    writeFileSync(outputPath, JSON.stringify(remapped));
}
//# sourceMappingURL=remap-anchors.js.map
interface Finding {
  path: string;
  line?: number | null;
  end_line?: number | null;
  start_line?: number | null;
  severity?: string;
  category?: string;
  message?: string;
  content?: string;
}

interface Anchor {
  path: string;
  line: number;
  is_resolved: boolean;
}

interface DiffFile {
  filename: string;
  patch?: string | null;
}

type DiffRanges = Map<string, Array<[number, number]>>;

interface ComputeFindingsInput {
  findings: Finding[] | null | undefined;
  anchors: Anchor[] | null | undefined;
  diffLines?: DiffRanges | null;
}

interface Comment {
  path: string;
  line: number;
  body: string;
}

interface ComputeFindingsResult {
  kept: Finding[];
  dropped: Finding[];
  resolved: Finding[];
  comments: Comment[];
  message: string | null;
  verdictComment: string | null;
  snappedCount: number;
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseDiffPatches(files: DiffFile[]): DiffRanges {
  const map: DiffRanges = new Map();
  for (const file of files) {
    if (!file.patch) continue;
    const ranges: Array<[number, number]> = [];
    for (const line of file.patch.split("\n")) {
      const m = line.match(HUNK_RE);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] != null ? Number(m[2]) : 1;
      ranges.push([start, start + count - 1]);
    }
    if (ranges.length > 0) map.set(file.filename, ranges);
  }
  return map;
}

export function snapToDiffLine(line: number, ranges: Array<[number, number]>): number {
  for (const [s, e] of ranges) {
    if (line >= s && line <= e) return line;
  }
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  for (const [s, e] of ranges) {
    const d = Math.min(Math.abs(line - s), Math.abs(line - e));
    if (d < bestDist) { bestDist = d; best = [s, e]; }
  }
  if (!best) return line;
  return Math.abs(line - best[0]) <= Math.abs(line - best[1]) ? best[0] : best[1];
}

export function computeFindings({ findings, anchors, diffLines }: ComputeFindingsInput): ComputeFindingsResult {
  const f = findings ?? [];
  const a = anchors ?? [];

  const isMatch = (finding: Finding, anchor: Anchor): boolean => {
    if (finding.path !== anchor.path) return false;
    if (finding.line != null && finding.line === anchor.line) return true;
    if (finding.line == null && finding.end_line != null && finding.end_line === anchor.line) return true;
    return false;
  };

  const dropped: Finding[] = [];
  const resolved: Finding[] = [];
  const kept: Finding[] = [];

  for (const finding of f) {
    const matchedAnchor = a.find((anchor) => isMatch(finding, anchor));
    if (!matchedAnchor) {
      kept.push(finding);
    } else if (matchedAnchor.is_resolved) {
      resolved.push(finding);
    } else {
      dropped.push(finding);
    }
  }

  let snappedCount = 0;
  const comments: Comment[] = kept.map((finding) => {
    const sevCat = `${finding.severity ?? "Info"}/${finding.category ?? "General"}`;
    let line = finding.line ?? finding.start_line ?? finding.end_line ?? 0;
    if (diffLines && line > 0) {
      const ranges = diffLines.get(finding.path);
      if (ranges) {
        const snapped = snapToDiffLine(line, ranges);
        if (snapped !== line) snappedCount++;
        line = snapped;
      }
    }
    return {
      path: finding.path,
      line,
      body: `**[${sevCat}]** ${finding.message || finding.content || ""}`,
    };
  });

  let message: string | null = null;
  if (kept.length === 0) {
    const total = dropped.length + resolved.length;
    if (total > 0) {
      message = `No new findings. ${total} previously flagged issue${total !== 1 ? "s" : ""} (${dropped.length} still open, ${resolved.length} resolved) suppressed as duplicate.`;
    }
  }

  return { kept, dropped, resolved, comments, message, verdictComment: null, snappedCount };
}

interface BuildVerdictInput {
  findings: Finding[];
  headSha: string;
  verdictMarker: string;
  headMarker: string;
  serenaStatus?: string;
  manifestFallbackReason?: string;
}

export function buildVerdictComment({ findings, headSha, verdictMarker, headMarker, serenaStatus, manifestFallbackReason }: BuildVerdictInput): string {
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
  const reviewMdLabel = manifestFallbackReason ? `not loaded (${manifestFallbackReason})` : "loaded";

  return `## Review Verdict

**Context:**
- Serena: ${serenaLabel}
- REVIEW.md: ${reviewMdLabel}

**Verdict: ${verdict}** — ${total} finding${total !== 1 ? "s" : ""} (${criticalCount} CRITICAL, ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW)

${headMarker} ${headSha} -->
${verdictMarker}
<!-- findings-json-start
${JSON.stringify(items, null, 2)}
findings-json-end -->`;
}
interface Finding {
  path: string;
  line?: number | null;
  end_line?: number | null;
  start_line?: number | null;
  severity?: string;
  category?: string;
  message: string;
}

interface Anchor {
  path: string;
  line: number;
  is_resolved: boolean;
}

interface ComputeFindingsInput {
  findings: Finding[] | null | undefined;
  anchors: Anchor[] | null | undefined;
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
}

export function computeFindings({ findings, anchors }: ComputeFindingsInput): ComputeFindingsResult {
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

  const comments: Comment[] = kept.map((finding) => {
    const sevCat = `${finding.severity ?? "Info"}/${finding.category ?? "General"}`;
    const line = finding.line ?? finding.start_line ?? finding.end_line ?? 0;
    return {
      path: finding.path,
      line,
      body: `**[OCR POC][${sevCat}]** ${finding.message}`,
    };
  });

  let message: string | null = null;
  if (kept.length === 0) {
    const total = dropped.length + resolved.length;
    if (total > 0) {
      message = `No new findings. ${total} previously flagged issue${total !== 1 ? "s" : ""} (${dropped.length} still open, ${resolved.length} resolved) suppressed as duplicate.`;
    }
  }

  return { kept, dropped, resolved, comments, message };
}
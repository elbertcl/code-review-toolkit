export function computeFindings({ findings, anchors }) {
  const f = findings ?? [];
  const a = anchors ?? [];

  const isMatch = (finding, anchor) => {
    if (finding.path !== anchor.path) return false;
    if (finding.line != null && finding.line === anchor.line) return true;
    if (finding.line == null && finding.end_line != null && finding.end_line === anchor.line) return true;
    return false;
  };

  const dropped = [];
  const kept = [];

  for (const finding of f) {
    const matched = a.some((anchor) => isMatch(finding, anchor));
    (matched ? dropped : kept).push(finding);
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
  if (kept.length === 0 && dropped.length > 0) {
    message = `No new findings. ${dropped.length} previously flagged issue${dropped.length !== 1 ? "s" : ""} still open on this PR (suppressed as duplicate).`;
  }

  return { kept, dropped, comments, message };
}

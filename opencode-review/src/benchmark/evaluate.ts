export interface ExpectedFinding {
  path: string;
  line_approx: number;
  severity: string;
  rule_id?: string;
}

export interface ActualFinding {
  path: string;
  line: number;
  severity: string;
  body: string;
}

export interface MatchResult {
  matched: Array<{ expected: ExpectedFinding; actual: ActualFinding }>;
  unmatchedExpected: ExpectedFinding[];
  unmatchedActual: ActualFinding[];
}

export interface CellResult {
  precision: number | null;
  recall: number | null;
  severity_match_rate: number | null;
  rule_citation_rate: number | null;
}

const ANCHOR_WINDOW = 5;

export function matchFindings(expected: ExpectedFinding[], actual: ActualFinding[]): MatchResult {
  const taken = new Set<number>();
  const matched: MatchResult["matched"] = [];
  const unmatchedExpected: ExpectedFinding[] = [];
  for (const e of expected) {
    const idx = actual.findIndex(
      (a, i) => !taken.has(i) && a.path === e.path && Math.abs(a.line - e.line_approx) <= ANCHOR_WINDOW,
    );
    if (idx >= 0) {
      taken.add(idx);
      matched.push({ expected: e, actual: actual[idx] });
    } else {
      unmatchedExpected.push(e);
    }
  }
  const unmatchedActual = actual.filter((_, i) => !taken.has(i));
  return { matched, unmatchedExpected, unmatchedActual };
}

export function evaluateCell(expected: ExpectedFinding[], actual: ActualFinding[]): CellResult {
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

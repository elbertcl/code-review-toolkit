interface Finding {
  severity?: string;
  [key: string]: unknown;
}

interface MeasurementRowInput {
  verdict: string;
  findings: Finding[] | null | undefined;
  suppressed: number;
  tokens: Record<string, number>;
  prNumber: number;
  sha: string;
}

interface SeverityTally {
  Critical: number;
  High: number;
  Medium: number;
  Low: number;
  Info: number;
  [key: string]: number;
}

interface MeasurementRow {
  lane: string;
  timestamp: string;
  pr: number;
  sha: string;
  context: { verdict: string };
  severity_tally: SeverityTally;
  suppressed_as_duplicate: number;
  tokens: Record<string, number | string>;
}

export function buildMeasurementRow({ verdict, findings, suppressed, tokens, prNumber, sha }: MeasurementRowInput): MeasurementRow {
  const severityTally: SeverityTally = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
  for (const finding of (findings ?? [])) {
    const sev = finding.severity ?? "Info";
    if (severityTally[sev] !== undefined) severityTally[sev] += 1;
    else severityTally[sev] = 1;
  }

  return {
    lane: "ocr",
    timestamp: new Date().toISOString(),
    pr: prNumber,
    sha,
    context: { verdict },
    severity_tally: severityTally,
    suppressed_as_duplicate: suppressed ?? 0,
    tokens: { ...tokens, source: "ocr_native" },
  };
}

export type FindingOutcome = "accepted" | "disputed" | "deferred" | "unclassified";

export interface FindingClassification {
  outcome: FindingOutcome;
  finding_id: string;
  classification_reason: string;
  confidence: "high" | "medium" | "low";
}

export function computeObservedPrecision(
  classifications: FindingClassification[]
): number | null {
  const scored = classifications.filter(
    (c) => c.outcome === "accepted" || c.outcome === "disputed"
  );
  if (scored.length === 0) return null;
  const accepted = scored.filter((c) => c.outcome === "accepted").length;
  return accepted / scored.length;
}

export function computeEstimatedRecall(
  matchedAiFindings: number,
  unmatchedHumanFindings: number
): number | null {
  const denominator = matchedAiFindings + unmatchedHumanFindings;
  if (denominator === 0) return null;
  return matchedAiFindings / denominator;
}

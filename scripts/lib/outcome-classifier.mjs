const OUTCOMES = new Set(["accepted", "disputed", "deferred", "unclassified"]);
const MARKER = /<!-- astro-ai-outcome:(\{[^\n]*\}) -->/g;

export function classifyOutcome({ findingId, isResolved, comments = [] }) {
  const explicit = comments
    .flatMap((comment) => [...String(comment.body ?? "").matchAll(MARKER)].flatMap((match) => {
      try {
        const value = JSON.parse(match[1]);
        return value.schema_version === 1 && value.finding_id === findingId && OUTCOMES.has(value.outcome)
          ? [{ outcome: value.outcome, created_at: comment.created_at ?? "" }]
          : [];
      } catch {
        return [];
      }
    }))
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .at(-1);
  if (explicit) return explicit.outcome;
  return isResolved ? "accepted" : "unclassified";
}

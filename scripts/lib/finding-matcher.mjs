import { classifyOutcome } from "./outcome-classifier.mjs";

const REVIEWER = "github-actions[bot]";
const MARKER = /<!-- astro-ai-finding:(\{[^\n]*\}) -->/g;
const SHA = /^[0-9a-f]{40}$/;

function hasValidProvenance(value) {
  if (typeof value.run_id !== "string" || !value.run_id || typeof value.run_url !== "string" || typeof value.workflow_path !== "string" || !SHA.test(value.toolkit_sha ?? "")) return false;
  try {
    const url = new URL(value.run_url);
    return url.protocol === "https:" && url.pathname.endsWith(`/actions/runs/${value.run_id}`);
  } catch {
    return false;
  }
}

function markers(body) {
  return [...String(body ?? "").matchAll(MARKER)].flatMap((match) => {
    try {
      const value = JSON.parse(match[1]);
      return value.schema_version === 1 && /^arf_[0-9a-f]{20}$/.test(value.finding_id) && hasValidProvenance(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

async function trustedMarker(marker, resolveTrustedRun) {
  if (typeof resolveTrustedRun !== "function") return false;
  const run = await resolveTrustedRun(marker.run_id);
  return run?.run_id === marker.run_id
    && run.run_url === marker.run_url
    && run.workflow_path === marker.workflow_path
    && run.conclusion === "success";
}

export async function matchFindingsToThreads({ reviewComments, threads, resolveTrustedRun }) {
  const trusted = new Map(reviewComments
    .filter((comment) => comment.user?.login === REVIEWER)
    .flatMap((comment) => markers(comment.body).map((marker) => [comment.id, { marker, created_at: comment.created_at ?? null }])));
  const provenance = new Map(await Promise.all([...trusted].map(async ([commentId, { marker }]) => [commentId, await trustedMarker(marker, resolveTrustedRun)])));
  const seen = new Set();
  return threads.flatMap((thread) => {
    const first = thread.comments?.nodes?.[0];
    const finding = first?.author?.login === REVIEWER ? trusted.get(first.databaseId) : undefined;
    if (!finding || !provenance.get(first.databaseId) || seen.has(finding.marker.finding_id)) return [];
    seen.add(finding.marker.finding_id);
    const { marker } = finding;
    return [{
      finding_id: marker.finding_id,
      thread_id: thread.id,
      dimension: marker.dimension,
      severity: marker.severity,
      created_at: finding.created_at,
      toolkit_sha: marker.toolkit_sha,
      provider: typeof marker.model === "string" ? marker.model.split("/")[0] : null,
      model: marker.model ?? null,
      confidence: marker.confidence ?? null,
      outcome: classifyOutcome({ findingId: marker.finding_id, isResolved: thread.isResolved, comments: thread.comments.nodes.slice(1) }),
    }];
  });
}

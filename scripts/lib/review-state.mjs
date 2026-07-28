const REVIEWER = "github-actions[bot]";
const FINDING_PATTERN = /<!-- astro-ai-finding:(\{[^\n]*\}) -->/g;
const RUN_PATTERN = /<!-- review-run-json\n(\{[^]*?\})\nreview-run-json -->/g;

function parseJsonMarkers(body, pattern) {
  return [...String(body ?? "").matchAll(pattern)].flatMap((match) => {
    try { return [JSON.parse(match[1])]; } catch { return []; }
  });
}

function validRun(value) {
  return value?.schema_version === 1 && typeof value.run_id === "string"
    && /^[0-9a-f]{40}$/.test(value.reviewed_head) && value.status === "COMPLETED";
}

function validFinding(value) {
  return value?.schema_version === 1 && /^arf_[0-9a-f]{20}$/.test(value.finding_id)
    && typeof value.run_id === "string" && /^[0-9a-f]{40}$/.test(value.reviewed_head);
}

export function reconstructReviewState({ headSha, mergeBaseSha, issueComments, reviewComments, threads, isAncestor }) {
  const runs = issueComments
    .filter((comment) => comment.user?.login === REVIEWER)
    .flatMap((comment) => parseJsonMarkers(comment.body, RUN_PATTERN).filter(validRun).map((run) => ({ ...run, created_at: comment.created_at })))
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const last = runs.at(-1);
  const priorFindings = reviewComments
    .filter((comment) => comment.user?.login === REVIEWER)
    .flatMap((comment) => parseJsonMarkers(comment.body, FINDING_PATTERN).filter(validFinding).map((marker) => ({ ...marker, comment_id: comment.id, path: comment.path, line: comment.line })));
  const byComment = new Map(priorFindings.map((finding) => [finding.comment_id, finding]));
  const knownThreads = threads.flatMap((thread) => {
    const first = thread.comments?.nodes?.[0];
    const finding = first?.author?.login === REVIEWER ? byComment.get(first.databaseId) : undefined;
    return finding ? [{ thread_id: thread.id, finding_id: finding.finding_id }] : [];
  });
  const ancestor = Boolean(last && isAncestor(last.reviewed_head, headSha));
  const skip = last?.reviewed_head === headSha;
  return {
    schema_version: 1,
    mode: ancestor ? "re-review" : "review",
    reviewed_head: headSha,
    last_reviewed_sha: last?.reviewed_head ?? null,
    diff_base: ancestor ? last.reviewed_head : mergeBaseSha,
    ancestor_fallback: Boolean(last && !ancestor),
    skip,
    skip_reason: skip ? "already_reviewed" : null,
    prior_findings: priorFindings,
    known_threads: knownThreads,
    known_thread_ids: knownThreads.map(({ thread_id }) => thread_id),
  };
}

function nextLink(link) {
  return link?.split(",").map((part) => part.trim()).find((part) => /rel="next"/.test(part))?.match(/^<([^>]+)>/)?.[1] ?? null;
}

async function paginateRest(fetchImpl, url, token) {
  const values = [];
  for (let next = url; next;) {
    const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    values.push(...await response.json());
    next = nextLink(response.headers.get("link"));
  }
  return values;
}

async function paginateGraphql(graphql) {
  const values = [];
  let cursor = null;
  do {
    const page = await graphql({ cursor });
    values.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return values;
}

export async function fetchReviewState({ fetch, graphql, apiBase, repository, prNumber, token }) {
  const root = `${apiBase}/repos/${repository}`;
  const [issueComments, reviewComments, commits, threads] = await Promise.all([
    paginateRest(fetch, `${root}/issues/${prNumber}/comments?per_page=100`, token),
    paginateRest(fetch, `${root}/pulls/${prNumber}/comments?per_page=100`, token),
    paginateRest(fetch, `${root}/pulls/${prNumber}/commits?per_page=100`, token),
    paginateGraphql(graphql),
  ]);
  return { issueComments, reviewComments, commits, threads };
}

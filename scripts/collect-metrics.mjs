import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { matchFindingsToThreads } from "./lib/finding-matcher.mjs";

function nextLink(link) {
  return link?.split(",").map((part) => part.trim()).find((part) => /rel="next"/.test(part))?.match(/^<([^>]+)>/)?.[1] ?? null;
}

export async function paginateRest(fetchImpl, url, token) {
  const values = [];
  for (let next = url; next;) {
    const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    values.push(...await response.json());
    next = nextLink(response.headers.get("link"));
  }
  return values;
}

export async function collectMetrics({ repository, pullRequests, loadFindings }) {
  const records = new Map();
  for (const pullRequest of new Map(pullRequests.map((pr) => [pr.number, pr])).values()) {
    for (const finding of await loadFindings(pullRequest.number)) {
      const key = `${repository}\0${pullRequest.number}\0${finding.finding_id}`;
      if (records.has(key)) continue;
      records.set(key, {
        repository,
        pr_number: pullRequest.number,
        finding_id: finding.finding_id,
        thread_id: finding.thread_id,
        dimension: finding.dimension,
        severity: finding.severity,
        outcome: finding.outcome,
        finding_created_at: finding.created_at,
        pr_merged_at: pullRequest.merged_at ?? null,
        toolkit_sha: finding.toolkit_sha,
        provider: finding.provider,
        model: finding.model,
        confidence: finding.confidence ?? null,
        review_latency_ms: finding.review_latency_ms ?? null,
        review_cost_usd: finding.review_cost_usd ?? null,
        matched_qualifying_human: finding.matched_qualifying_human === true,
        unmatched_qualifying_human_count: finding.unmatched_qualifying_human_count ?? 0,
      });
    }
  }
  return [...records.values()].sort((left, right) => `${left.repository}/${left.pr_number}/${left.finding_id}`.localeCompare(`${right.repository}/${right.pr_number}/${right.finding_id}`));
}

export async function collectFromGitHubFixture(input) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month ?? "")) throw new Error("month must use YYYY-MM");
  const matchesByPr = input.human_matches_by_pr ?? {};
  const trustedRuns = new Map((input.trustedRuns ?? []).map((run) => [String(run.run_id), run]));
  const pullRequests = (input.pull_requests ?? []).filter((pr) => pr.created_at?.startsWith(`${input.month}-`));
  const records = await collectMetrics({
    repository: input.repository,
    pullRequests,
    loadFindings: async (number) => {
      const pr = pullRequests.find((candidate) => candidate.number === number);
      const humanMatches = matchesByPr[number] ?? [];
      const findings = await matchFindingsToThreads({
        reviewComments: input.review_comments_by_pr?.[number] ?? [],
        threads: input.threads_by_pr?.[number] ?? [],
        resolveTrustedRun: async (runId) => trustedRuns.get(runId),
      });
      const matched = new Set(humanMatches.filter((value) => value.qualifies === true).map((value) => value.ai_finding_id));
      const unmatched = humanMatches.filter((value) => value.qualifies === true && !value.ai_finding_id).length;
      return findings.map((finding, index) => ({
        ...finding,
        review_latency_ms: pr?.analysis?.latency_ms ?? null,
        review_cost_usd: pr?.analysis?.cost_usd ?? null,
        confidence: finding.confidence ?? pr?.analysis?.confidence ?? null,
        matched_qualifying_human: matched.has(finding.finding_id),
        unmatched_qualifying_human_count: index === 0 ? unmatched : 0,
      }));
    },
  });
  for (const pr of pullRequests) {
    const unmatched = (matchesByPr[pr.number] ?? []).filter((value) => value.qualifies === true && !value.ai_finding_id).length;
    if (unmatched && !records.some((record) => record.pr_number === pr.number)) {
      records.push({
        record_type: "human_baseline",
        repository: input.repository,
        pr_number: pr.number,
        unmatched_qualifying_human_count: unmatched,
      });
    }
  }
  return records;
}

async function main() {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  if (process.argv[3]) input.month = process.argv[3];
  if (input.pull_requests) {
    process.stdout.write(`${JSON.stringify(await collectFromGitHubFixture(input), null, 2)}\n`);
    return;
  }
  const findings = input.findings_by_pr ?? {};
  process.stdout.write(`${JSON.stringify(await collectMetrics({ ...input, loadFindings: async (number) => findings[number] ?? [] }), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

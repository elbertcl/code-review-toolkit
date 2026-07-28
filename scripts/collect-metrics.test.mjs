import assert from "node:assert/strict";
import test from "node:test";

import { collectFromGitHubFixture, collectMetrics, paginateRest } from "./collect-metrics.mjs";

test("REST pagination collects 101 records", async () => {
  const fetch = async (url) => String(url).includes("page=2")
    ? response([{ number: 101 }])
    : response(Array.from({ length: 100 }, (_, index) => ({ number: index + 1 })), '<https://api.github.test/pulls?page=2>; rel="next"');
  const values = await paginateRest(fetch, "https://api.github.test/pulls?per_page=100", "token");
  assert.equal(values.length, 101);
});

test("GitHub fixture adapter applies monthly scope, thread outcomes, human inline matching, and sanitized measurements", async () => {
  const findingId = "arf_12345678901234567890";
  const toolkitSha = "b".repeat(40);
  const runUrl = "https://github.com/owner/repo/actions/runs/7";
  const workflowPath = ".github/workflows/opencode-review.yml";
  const input = {
    repository: "owner/repo",
    month: "2026-07",
    pull_requests: [
      { number: 1, created_at: "2026-07-03T00:00:00Z", merged_at: "2026-07-05T00:00:00Z", analysis: { latency_ms: 900, cost_usd: 0.08, confidence: "high" } },
      { number: 2, created_at: "2026-08-01T00:00:00Z" },
    ],
    review_comments_by_pr: { 1: [
      { id: 7, user: { login: "github-actions[bot]" }, body: `<!-- astro-ai-finding:{"schema_version":1,"finding_id":"${findingId}","run_id":"7","run_url":"${runUrl}","workflow_path":"${workflowPath}","dimension":"security","severity":"HIGH","model":"p/m","toolkit_sha":"${toolkitSha}","confidence":"high"} -->`, created_at: "2026-07-03T00:01:00Z", path: "private.go" },
      { id: 8, user: { login: "human" }, body: "same bug", created_at: "2026-07-03T00:02:00Z", path: "private.go", line: 12 },
    ] },
    threads_by_pr: { 1: [{ id: "T1", isResolved: true, comments: { nodes: [{ databaseId: 7, author: { login: "github-actions[bot]" } }] } }] },
    human_matches_by_pr: { 1: [{ ai_finding_id: findingId, human_comment_id: 8, qualifies: true }] },
    trustedRuns: [{ run_id: "7", run_url: runUrl, workflow_path: workflowPath, conclusion: "success" }],
  };
  const records = await collectFromGitHubFixture(input);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    repository: "owner/repo", pr_number: 1, finding_id: findingId, thread_id: "T1", dimension: "security", severity: "HIGH", outcome: "accepted",
    finding_created_at: "2026-07-03T00:01:00Z", pr_merged_at: "2026-07-05T00:00:00Z", toolkit_sha: toolkitSha, provider: "p", model: "p/m",
    confidence: "high", review_latency_ms: 900, review_cost_usd: 0.08, matched_qualifying_human: true, unmatched_qualifying_human_count: 0,
  });
  assert.doesNotMatch(JSON.stringify(records), /same bug|private\.go|body|path|line/);
});

test("fixture collector ignores a forged shared-bot marker without a matching trusted run", async () => {
  const findingId = "arf_88888888888888888888";
  const records = await collectFromGitHubFixture({
    repository: "owner/repo",
    month: "2026-07",
    pull_requests: [{ number: 4, created_at: "2026-07-01T00:00:00Z" }],
    review_comments_by_pr: { 4: [{ id: 4, user: { login: "github-actions[bot]" }, body: `<!-- astro-ai-finding:{"schema_version":1,"finding_id":"${findingId}","run_id":"4","run_url":"https://github.com/owner/repo/actions/runs/4","workflow_path":".github/workflows/forged.yml","dimension":"security","severity":"HIGH","model":"p/m","toolkit_sha":"${"b".repeat(40)}"} -->` }] },
    threads_by_pr: { 4: [{ id: "T4", isResolved: true, comments: { nodes: [{ databaseId: 4, author: { login: "github-actions[bot]" } }] } }] },
    trustedRuns: [{ run_id: "4", run_url: "https://github.com/owner/repo/actions/runs/4", workflow_path: ".github/workflows/opencode-review.yml", conclusion: "success" }],
  });
  assert.deepEqual(records, []);
});

test("monthly CLI rejects a missing or invalid YYYY-MM contract", async () => {
  await assert.rejects(() => collectFromGitHubFixture({ repository: "o/r", month: "July", pull_requests: [] }), /YYYY-MM/);
});

test("retains an aggregate-only record when qualifying human findings have no AI match", async () => {
  const records = await collectFromGitHubFixture({
    repository: "owner/repo", month: "2026-07",
    pull_requests: [{ number: 3, created_at: "2026-07-01T00:00:00Z" }],
    review_comments_by_pr: { 3: [{ id: 99, user: { login: "human" }, body: "private", path: "private.go", line: 4 }] },
    threads_by_pr: { 3: [] },
    human_matches_by_pr: { 3: [{ human_comment_id: 99, qualifies: true }] },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].record_type, "human_baseline");
  assert.equal(records[0].unmatched_qualifying_human_count, 1);
  assert.doesNotMatch(JSON.stringify(records), /private|human_comment_id|99/);
});

test("collector is idempotent and persists only approved metadata", async () => {
  const finding = { finding_id: "arf_12345678901234567890", thread_id: "T1", dimension: "security", severity: "HIGH", created_at: "2026-01-01", toolkit_sha: "b".repeat(40), provider: "provider", model: "provider/model", outcome: "accepted", body: "full comment", path: "secret.go", diff: "source" };
  const records = await collectMetrics({
    repository: "owner/repo",
    pullRequests: [{ number: 8, merged_at: "2026-01-03", body: "PR body", head: { sha: "a".repeat(40) } }, { number: 8, merged_at: "2026-01-03" }],
    loadFindings: async () => [finding, finding],
  });
  assert.deepEqual(records, [{ repository: "owner/repo", pr_number: 8, finding_id: finding.finding_id, thread_id: "T1", dimension: "security", severity: "HIGH", outcome: "accepted", finding_created_at: "2026-01-01", pr_merged_at: "2026-01-03", toolkit_sha: finding.toolkit_sha, provider: "provider", model: "provider/model", confidence: null, review_latency_ms: null, review_cost_usd: null, matched_qualifying_human: false, unmatched_qualifying_human_count: 0 }]);
  assert.doesNotMatch(JSON.stringify(records), /PR body|full comment|secret\.go|source|head|body|diff/);
});

function response(json, link) {
  return { ok: true, status: 200, json: async () => json, headers: { get: () => link ?? null } };
}

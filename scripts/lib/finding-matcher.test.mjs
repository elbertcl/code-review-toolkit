import assert from "node:assert/strict";
import test from "node:test";

import { matchFindingsToThreads } from "./finding-matcher.mjs";

const head = "a".repeat(40);
const toolkitSha = "b".repeat(40);
const workflowPath = ".github/workflows/opencode-review.yml";
const runUrl = "https://github.com/owner/repo/actions/runs/1";
const marker = (findingId, overrides = {}) => `finding text\n<!-- astro-ai-finding:${JSON.stringify({ schema_version: 1, finding_id: findingId, run_id: "1", run_url: runUrl, workflow_path: workflowPath, dimension: "security", severity: "HIGH", reviewed_head: head, model: "provider/model", toolkit_sha: toolkitSha, ...overrides })} -->`;
const resolveTrustedRun = async () => ({ run_id: "1", run_url: runUrl, workflow_path: workflowPath, conclusion: "success" });

test("matches bot finding markers to their review threads without retaining bodies", async () => {
  const findingId = "arf_12345678901234567890";
  const matches = await matchFindingsToThreads({
    reviewComments: [{ id: 7, user: { login: "github-actions[bot]" }, body: marker(findingId), created_at: "2026-01-01", path: "secret.go", diff_hunk: "private source" }],
    threads: [{ id: "T1", isResolved: true, comments: { nodes: [{ databaseId: 7, body: marker(findingId), author: { login: "github-actions[bot]" } }] } }],
    resolveTrustedRun,
  });

  assert.deepEqual(matches, [{ finding_id: findingId, thread_id: "T1", dimension: "security", severity: "HIGH", created_at: "2026-01-01", toolkit_sha: toolkitSha, provider: "provider", model: "provider/model", confidence: null, outcome: "accepted" }]);
  assert.doesNotMatch(JSON.stringify(matches), /finding text|private source|secret\.go|body|diff_hunk/);
});

test("deduplicates repeated finding IDs and ignores untrusted markers", async () => {
  const findingId = "arf_12345678901234567890";
  const result = await matchFindingsToThreads({
    reviewComments: [
      { id: 1, user: { login: "attacker" }, body: marker("arf_00000000000000000000") },
      { id: 2, user: { login: "github-actions[bot]" }, body: marker(findingId) },
      { id: 3, user: { login: "github-actions[bot]" }, body: marker(findingId) },
    ],
    threads: [
      { id: "T2", isResolved: false, comments: { nodes: [{ databaseId: 2, author: { login: "github-actions[bot]" } }] } },
      { id: "T3", isResolved: true, comments: { nodes: [{ databaseId: 3, author: { login: "github-actions[bot]" } }] } },
    ],
    resolveTrustedRun,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].thread_id, "T2");
});

test("ignores forged shared-bot markers whose Actions run provenance is not trusted", async () => {
  const cases = [
    { run_url: "https://github.com/owner/repo/actions/runs/forged" },
    { workflow_path: ".github/workflows/forged.yml" },
    { toolkit_sha: "mutable-tag" },
  ];
  for (const [index, overrides] of cases.entries()) {
    const findingId = `arf_${String(index).padStart(20, "0")}`;
    const result = await matchFindingsToThreads({
      reviewComments: [{ id: index + 1, user: { login: "github-actions[bot]" }, body: marker(findingId, overrides) }],
      threads: [{ id: `T${index}`, isResolved: false, comments: { nodes: [{ databaseId: index + 1, author: { login: "github-actions[bot]" } }] } }],
      resolveTrustedRun,
    });
    assert.deepEqual(result, []);
  }
});

test("ignores markers when the trusted Actions run did not succeed", async () => {
  const findingId = "arf_99999999999999999999";
  const result = await matchFindingsToThreads({
    reviewComments: [{ id: 9, user: { login: "github-actions[bot]" }, body: marker(findingId) }],
    threads: [{ id: "T9", isResolved: false, comments: { nodes: [{ databaseId: 9, author: { login: "github-actions[bot]" } }] } }],
    resolveTrustedRun: async () => ({ run_id: "1", run_url: runUrl, workflow_path: workflowPath, conclusion: "failure" }),
  });
  assert.deepEqual(result, []);
});

test("validates each marker independently when a forged marker claims a trusted run ID", async () => {
  const trustedId = "arf_77777777777777777777";
  const forgedId = "arf_66666666666666666666";
  const result = await matchFindingsToThreads({
    reviewComments: [
      { id: 7, user: { login: "github-actions[bot]" }, body: marker(trustedId) },
      { id: 6, user: { login: "github-actions[bot]" }, body: marker(forgedId, { workflow_path: ".github/workflows/forged.yml" }) },
    ],
    threads: [
      { id: "T7", isResolved: true, comments: { nodes: [{ databaseId: 7, author: { login: "github-actions[bot]" } }] } },
      { id: "T6", isResolved: true, comments: { nodes: [{ databaseId: 6, author: { login: "github-actions[bot]" } }] } },
    ],
    resolveTrustedRun,
  });
  assert.deepEqual(result.map(({ finding_id }) => finding_id), [trustedId]);
});

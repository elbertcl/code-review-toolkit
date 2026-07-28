import assert from "node:assert/strict";
import test from "node:test";

import { prepareReviewState } from "./prepare-review-state.mjs";

test("prepares reconstructed state from every paginated GitHub source", async () => {
  const oldHead = "a".repeat(40);
  const headSha = "b".repeat(40);
  const findingId = "arf_12345678901234567890";
  const state = await prepareReviewState({
    headSha,
    mergeBaseSha: "c".repeat(40),
    fetchState: async () => ({
      issueComments: [{ user: { login: "github-actions[bot]" }, created_at: "2026-01-01", body: `<!-- review-run-json\n{"schema_version":1,"run_id":"1","reviewed_head":"${oldHead}","status":"COMPLETED"}\nreview-run-json -->` }],
      reviewComments: [{ id: 7, user: { login: "github-actions[bot]" }, body: `<!-- astro-ai-finding:{"schema_version":1,"finding_id":"${findingId}","run_id":"1","reviewed_head":"${oldHead}"} -->` }],
      threads: [{ id: "T1", comments: { nodes: [{ databaseId: 7, author: { login: "github-actions[bot]" } }] } }],
    }),
    isAncestor: (ancestor, descendant) => ancestor === oldHead && descendant === headSha,
  });
  assert.equal(state.mode, "re-review");
  assert.deepEqual(state.known_threads, [{ thread_id: "T1", finding_id: findingId }]);
});

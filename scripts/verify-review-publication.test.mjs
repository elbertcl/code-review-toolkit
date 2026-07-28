import assert from "node:assert/strict";
import test from "node:test";

import { fetchAndVerifyPublication, verifyPublication } from "./verify-review-publication.mjs";

const sha = "a".repeat(40);
const provenance = `"workflow_path":".github/workflows/opencode-review.yml","run_url":"https://github.com/o/r/actions/runs/9","toolkit_sha":"${sha}"`;
const marker = (id) => `text\n<!-- astro-ai-finding:{"schema_version":1,"finding_id":"${id}","run_id":"9","reviewed_head":"${sha}",${provenance}} -->`;
const verdict = `<!-- review-run-json\n{"schema_version":1,"run_id":"9","reviewed_head":"${sha}","status":"COMPLETED","findings":["arf_one","arf_two"],${provenance}}\nreview-run-json -->\n<!-- reviewed-head: ${sha} -->\n<!-- opencode-pr-review -->`;
const bot = { login: "github-actions[bot]" };

test("requires every current-run finding and both completion markers", () => {
  assert.deepEqual(verifyPublication({ runId: "9", reviewedHead: sha, findingIds: ["arf_one", "arf_two"], workflowPath: ".github/workflows/opencode-review.yml", runUrl: "https://github.com/o/r/actions/runs/9", toolkitSha: sha, inlineComments: [{ user: bot, body: marker("arf_one") }, { user: bot, body: marker("arf_two") }], issueComments: [{ user: bot, body: verdict }] }), { complete: true, missing: [] });
});

test("partial publication is incomplete", () => {
  const result = verifyPublication({ runId: "9", reviewedHead: sha, findingIds: ["arf_one", "arf_two"], workflowPath: ".github/workflows/opencode-review.yml", runUrl: "https://github.com/o/r/actions/runs/9", toolkitSha: sha, inlineComments: [{ user: bot, body: marker("arf_one") }], issueComments: [{ user: bot, body: verdict }] });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ["arf_two"]);
});

test("rejects forged marker authors and provenance", () => {
  const expected = { runId: "9", reviewedHead: sha, findingIds: ["arf_one"], workflowPath: ".github/workflows/opencode-review.yml", runUrl: "https://github.com/o/r/actions/runs/9", toolkitSha: sha };
  assert.equal(verifyPublication({ ...expected, inlineComments: [{ user: { login: "attacker" }, body: marker("arf_one") }], issueComments: [{ user: bot, body: verdict }] }).complete, false);
  assert.equal(verifyPublication({ ...expected, inlineComments: [{ user: bot, body: marker("arf_one").replace("opencode-review.yml", "evil.yml") }], issueComments: [{ user: bot, body: verdict }] }).complete, false);
});

test("immediate fetch verification accepts only the exact current in-progress Actions run", async () => {
  const fetch = async (url) => {
    const text = String(url);
    if (text.includes("/actions/runs/9")) return response({ id: 9, path: ".github/workflows/opencode-review.yml", status: "in_progress", conclusion: null, html_url: "https://github.com/o/r/actions/runs/9" });
    if (text.includes("/pulls/1/comments")) return response([{ user: bot, body: marker("arf_one") }]);
    if (text.includes("/issues/1/comments")) return response([{ user: bot, body: verdict }]);
    throw new Error(`unexpected ${text}`);
  };
  const result = await fetchAndVerifyPublication({ fetch, token: "x", repository: "o/r", prNumber: 1, runId: "9", reviewedHead: sha, findingIds: ["arf_one"], workflowPath: ".github/workflows/opencode-review.yml", runUrl: "https://github.com/o/r/actions/runs/9", toolkitSha: sha });
  assert.equal(result.complete, true);
  const untrusted = await fetchAndVerifyPublication({ fetch: async (url) => String(url).includes("/actions/runs/9") ? response({ id: 9, path: ".github/workflows/evil.yml", status: "in_progress", conclusion: null, html_url: "https://github.com/o/r/actions/runs/9" }) : fetch(url), token: "x", repository: "o/r", prNumber: 1, runId: "9", reviewedHead: sha, findingIds: ["arf_one"], workflowPath: ".github/workflows/opencode-review.yml", runUrl: "https://github.com/o/r/actions/runs/9", toolkitSha: sha });
  assert.equal(untrusted.complete, false);
});

test("immediate verification rejects failed and different in-progress runs", async () => {
  const expected = { token: "x", repository: "o/r", prNumber: 1, runId: "9", reviewedHead: sha, findingIds: ["arf_one"], workflowPath: ".github/workflows/opencode-review.yml", runUrl: "https://github.com/o/r/actions/runs/9", toolkitSha: sha };
  const fetchFor = (run) => async (url) => String(url).includes("/actions/runs/9") ? response(run) : String(url).includes("/pulls/1/comments") ? response([{ user: bot, body: marker("arf_one") }]) : response([{ user: bot, body: verdict }]);
  assert.equal((await fetchAndVerifyPublication({ ...expected, fetch: fetchFor({ id: 9, path: expected.workflowPath, status: "completed", conclusion: "failure", html_url: expected.runUrl }) })).complete, false);
  assert.equal((await fetchAndVerifyPublication({ ...expected, fetch: fetchFor({ id: 8, path: expected.workflowPath, status: "in_progress", conclusion: null, html_url: expected.runUrl }) })).complete, false);
});

function response(json, link) { return { ok: true, status: 200, json: async () => json, headers: { get: () => link ?? null } }; }

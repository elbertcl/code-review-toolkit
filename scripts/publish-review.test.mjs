import assert from "node:assert/strict";
import test from "node:test";

import { publishReview } from "./publish-review.mjs";

const sha = "a".repeat(40);
const findings = { schema_version: 1, reviewed_head: sha, mode: "re-review", prior_thread_classifications: [{ thread_id: "T1", finding_id: "arf_old", outcome: "RESOLVED", reason: "Fixed in current code." }], findings: [{ dimension: "security", severity: "HIGH", path: "main.go", line: 2, side: "RIGHT", symbol: "main", title: "Unsafe input", body: "Input reaches sink.", suggested_fix: "Validate input." }] };

test("revalidates hostile findings and checks head immediately before every mutation", async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? "GET", body: options.body });
    if ((options.method ?? "GET") === "GET") return response({ head: { sha } });
    if (String(url).endsWith("/reviews")) return response({ id: 1 }, 200);
    if (String(url).endsWith("/graphql")) return response({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
    return response({ id: 2 }, 201);
  };
  const result = await publishReview({ fetch, token: "secret", repository: "o/r", prNumber: 1, runId: "9", runUrl: "https://github.com/o/r/actions/runs/9", workflowPath: ".github/workflows/opencode-review.yml", findings, knownThreads: [{ thread_id: "T1", finding_id: "arf_old" }], validation: validationOptions(), model: "m", toolkitVersion: sha, evidenceStatus: "READY", contextStatus: "READY", serenaStatus: "unavailable", serenaWarning: "Serena setup failed; review continued without Serena.", serenaRevision: "b".repeat(40) });
  assert.equal(result.status, "completed");
  assert.match(calls.at(-1).body, /Serena setup failed/);
  assert.match(calls.at(-1).body, /\\"serena_revision\\":\\"b{40}\\"/);
  assert.equal(calls.filter((call) => call.method === "GET").length, 3);
  assert.deepEqual(new Set(calls.filter((call) => call.method !== "GET").map((call) => new URL(call.url).pathname)), new Set(["/repos/o/r/pulls/1/reviews", "/graphql", "/repos/o/r/issues/1/comments"]));
  assert.match(calls.find((call) => call.url.endsWith("/reviews")).body, /astro-ai-finding/);
  assert.match(calls.find((call) => call.url.endsWith("/reviews")).body, /workflow_path/);
  assert.match(calls.find((call) => call.url.endsWith("/reviews")).body, /run_url/);
  assert.match(calls.at(-1).body, /review-run-json/);
});

test("checks a changed head immediately before each thread resolution", async () => {
  let heads = 0;
  const twoThreads = { ...findings, prior_thread_classifications: [...findings.prior_thread_classifications, { thread_id: "T2", finding_id: "arf_two", outcome: "RESOLVED", reason: "Fixed." }] };
  const knownThreads = [{ thread_id: "T1", finding_id: "arf_old" }, { thread_id: "T2", finding_id: "arf_two" }];
  const fetch = async (url, options = {}) => {
    if ((options.method ?? "GET") === "GET") return response({ head: { sha: ++heads === 1 ? sha : "b".repeat(40) } });
    if (String(url).endsWith("/graphql")) return response({ data: {} });
    throw new Error("unexpected mutation");
  };
  const result = await publishReview({ fetch, token: "x", repository: "o/r", prNumber: 1, runId: "9", runUrl: "https://github.com/o/r/actions/runs/9", workflowPath: ".github/workflows/opencode-review.yml", findings: twoThreads, knownThreads, validation: { ...validationOptions(), priorFindings: knownThreads, knownThreadIds: ["T1", "T2"] }, model: "m", toolkitVersion: sha });
  assert.equal(result.status, "stale");
});

test("publisher independently rejects malformed paths and anchors", async () => {
  const hostile = { ...findings, findings: [{ ...findings.findings[0], path: "../secret", line: 999 }] };
  await assert.rejects(() => publishReview({ fetch: async () => { throw new Error("called"); }, token: "x", repository: "o/r", prNumber: 1, runId: "9", findings: hostile, knownThreads: [{ thread_id: "T1", finding_id: "arf_old" }], validation: validationOptions(), model: "m", toolkitVersion: sha }), /addressable/);
});

test("stale head performs no mutation", async () => {
  const calls = [];
  const result = await publishReview({ fetch: async (url, options = {}) => { calls.push(options.method ?? "GET"); return response({ head: { sha: "b".repeat(40) } }); }, token: "x", repository: "o/r", prNumber: 1, runId: "9", findings, knownThreads: [{ thread_id: "T1", finding_id: "arf_old" }], validation: validationOptions(), model: "m", toolkitVersion: sha });
  assert.equal(result.status, "stale");
  assert.deepEqual(calls, ["GET"]);
});

test("rejects model-supplied unknown thread IDs before requests", async () => {
  await assert.rejects(() => publishReview({ fetch: async () => { throw new Error("called"); }, token: "x", repository: "o/r", prNumber: 1, runId: "9", findings, knownThreads: [], validation: validationOptions(), model: "m", toolkitVersion: sha }), /unknown prior thread|unknown thread/);
});

function validationOptions() {
  return { reviewedHead: sha, mode: "re-review", dimensions: ["security"], changedPaths: ["main.go"], addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [{ thread_id: "T1", finding_id: "arf_old" }], knownThreadIds: ["T1"] };
}

function response(json, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json), headers: { get: () => null } }; }

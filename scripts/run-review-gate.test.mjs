import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { authorizeRequester, findSizeOverride, githubRequest, runReviewGate } from "./run-review-gate.mjs";

const body = `## Review Decision
### Purpose
Prevent duplicate deductions after retries.
### Approach And Tradeoffs
Persist a unique event reference at a small lookup cost.
## Verification Evidence
### Commands
\`go test ./...\`
### Result
PASS: all tests.
### No-Test Exception
Not applicable.
`;

const manifest = {
  required_checks: [{ name: "Build and Test", category: "test" }],
  diff_limits: { changed_files: 40, changed_lines: 1200 },
  diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
  docs_only_paths: ["docs/**", "**/*.md"],
  excluded_paths: ["mocks/**", "**/*.pb.go"],
};

function response(json, { link, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "link" ? link ?? null : null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function fixtureFetch(overrides = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes("/pulls/7/files")) return response(overrides.files ?? [{ filename: "main.go", additions: 10, deletions: 2 }]);
    if (url.includes("/check-runs")) return response({ check_runs: overrides.checkRuns ?? [{ name: "Build and Test", status: "completed", conclusion: "success", app: { slug: "github-actions" } }] });
    if (url.includes("/statuses")) return response(overrides.statuses ?? []);
    if (url.includes("/issues/7/events")) return response(overrides.events ?? []);
    if (url.includes("/collaborators/")) return response({ permission: overrides.permission ?? "write" });
    if (url.includes("/pulls/7")) return response({
      body, draft: false, changed_files: 1, additions: 10, deletions: 2,
      user: { login: "author" }, head: { sha: "a".repeat(40), repo: { full_name: "org/repo" } },
      base: { sha: "b".repeat(40), repo: { full_name: "org/repo" } }, ...overrides.pr,
    });
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetch, calls };
}

test("authorizes the PR author or trusted association", () => {
  assert.equal(authorizeRequester({ login: "author", association: "NONE", prAuthor: "author" }), true);
  assert.equal(authorizeRequester({ login: "maintainer", association: "MEMBER", prAuthor: "author" }), true);
  assert.equal(authorizeRequester({ login: "stranger", association: "CONTRIBUTOR", prAuthor: "author" }), false);
});

test("uses the latest override add/remove event and rejects bots or lost permission", async () => {
  const events = [
    { event: "labeled", label: { name: "override" }, actor: { login: "owner", type: "User" }, created_at: "2026-01-01" },
    { event: "unlabeled", label: { name: "override" }, actor: { login: "owner", type: "User" }, created_at: "2026-01-02" },
  ];
  assert.deepEqual(await findSizeOverride({ events, label: "override", getPermission: async () => "write" }), { active: false, authorized: false });
  events.push({ event: "labeled", label: { name: "override" }, actor: { login: "owner", type: "User" }, created_at: "2026-01-03" });
  assert.deepEqual(await findSizeOverride({ events, label: "override", getPermission: async () => "write" }), { active: true, authorized: true });
  assert.deepEqual(await findSizeOverride({ events, label: "override", getPermission: async () => "read" }), { active: true, authorized: false });
  events.push({ event: "labeled", label: { name: "override" }, actor: { login: "dependabot", type: "Bot" }, created_at: "2026-01-04" });
  assert.deepEqual(await findSizeOverride({ events, label: "override", getPermission: async () => "admin" }), { active: true, authorized: false });
  assert.deepEqual(await findSizeOverride({ events: events.slice(0, 3), label: "override", authorizedAssociations: ["MEMBER"], getPermission: async () => "write" }), { active: true, authorized: false });
  events[2].actor.association = "MEMBER";
  assert.deepEqual(await findSizeOverride({ events: events.slice(0, 3), label: "override", authorizedAssociations: ["MEMBER"], getPermission: async () => "write" }), { active: true, authorized: true });
});

test("collaborator 404 denies an override while other permission errors fail", async () => {
  const events = [{ event: "labeled", label: { name: "override" }, actor: { login: "former", type: "User", association: "MEMBER" }, created_at: "2026-01-01" }];
  assert.deepEqual(await findSizeOverride({ events, label: "override", authorizedAssociations: ["MEMBER"], getPermission: async () => { const error = new Error("not found"); error.status = 404; throw error; } }), { active: true, authorized: false });
  await assert.rejects(findSizeOverride({ events, label: "override", authorizedAssociations: ["MEMBER"], getPermission: async () => { const error = new Error("boom"); error.status = 500; throw error; } }), /boom/);
});

test("GitHub requests retry bounded transient failures and enforce timeout", async () => {
  let attempts = 0;
  const result = await githubRequest(async (_url, options) => {
    attempts += 1;
    assert.ok(options.signal);
    return attempts === 1 ? response({}, { status: 429 }) : response({ ok: true });
  }, "https://api.github.com/test", "token", { sleep: async () => {}, maxRetries: 2, timeoutMs: 10 });
  assert.equal((await result.json()).ok, true);
  assert.equal(attempts, 2);
});

test("fetches paginated files and writes filtered gate artifacts and outputs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "review-gate-"));
  const firstFiles = response([{ filename: "mocks/generated.go", additions: 50, deletions: 1 }], { link: '<https://api.github.com/page2>; rel="next"' });
  const secondFiles = response([{ filename: "main.go", additions: 10, deletions: 2 }]);
  const fixture = fixtureFetch();
  const fetch = async (url, options) => url === "https://api.github.com/page2" ? secondFiles : url.includes("/pulls/7/files") ? firstFiles : fixture.fetch(url, options);
  const result = await runReviewGate({
    fetch, repository: "org/repo", prNumber: 7, token: "secret", workspace,
    requester: { login: "author", association: "NONE" },
    readTrustedManifest: async (baseSha) => {
      assert.equal(baseSha, "b".repeat(40));
      return manifest;
    },
  });
  assert.equal(result.proceed, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(workspace, ".opencode/tmp/changed-files.json"))), ["main.go"]);
  assert.doesNotMatch(await readFile(path.join(workspace, ".opencode/tmp/review-gate.json"), "utf8"), /secret/);
  assert.ok(fixture.calls.some((url) => url.includes("/check-runs")));
});

test("blocks unauthorized, draft, fork, and context BLOCKED before check analysis", async () => {
  for (const scenario of [
    { requester: { login: "stranger", association: "NONE" } },
    { pr: { draft: true }, requester: { login: "author", association: "NONE" } },
    { pr: { head: { sha: "a".repeat(40), repo: { full_name: "fork/repo" } } }, requester: { login: "author", association: "NONE" } },
  ]) {
    const fixture = fixtureFetch({ pr: scenario.pr });
    const result = await runReviewGate({ fetch: fixture.fetch, repository: "org/repo", prNumber: 7, token: "x", workspace: await mkdtemp(path.join(os.tmpdir(), "gate-block-")), requester: scenario.requester, readTrustedManifest: async () => manifest });
    assert.equal(result.proceed, false);
    assert.equal(fixture.calls.some((url) => url.includes("/check-runs")), false);
  }

  const fixture = fixtureFetch();
  const result = await runReviewGate({ fetch: fixture.fetch, repository: "org/repo", prNumber: 7, token: "x", workspace: await mkdtemp(path.join(os.tmpdir(), "gate-context-")), requester: { login: "author", association: "NONE" }, readTrustedManifest: async () => manifest, contextStatus: "BLOCKED" });
  assert.equal(result.proceed, false);
  assert.equal(fixture.calls.some((url) => url.includes("/check-runs")), false);
});

test("unexpected API failures reject instead of becoming expected blocks", async () => {
  const fixture = fixtureFetch();
  const fetch = async (url, options) => url.includes("/check-runs") ? response({ message: "boom" }, { status: 500 }) : fixture.fetch(url, options);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gate-error-"));
  await assert.rejects(() => runReviewGate({ fetch, repository: "org/repo", prNumber: 7, token: "x", workspace, requester: { login: "author", association: "NONE" }, readTrustedManifest: async () => manifest }), /GitHub API 500/);
});

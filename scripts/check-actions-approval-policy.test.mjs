import assert from "node:assert/strict";
import test from "node:test";

import { checkApprovalPolicy } from "./check-actions-approval-policy.mjs";
import { readFile } from "node:fs/promises";

test("accepts a disabled Actions approval policy", async () => {
  const result = await checkApprovalPolicy(async () => ({
    ok: true,
    json: async () => ({ can_approve_pull_request_reviews: false }),
  }));
  assert.deepEqual(result, { compliant: true });
});

test("rejects enabled or missing approval policy", async () => {
  for (const body of [{ can_approve_pull_request_reviews: true }, {}]) {
    await assert.rejects(
      checkApprovalPolicy(async () => ({ ok: true, json: async () => body })),
      /can_approve_pull_request_reviews/,
    );
  }
});

test("reports API failures without treating them as compliant", async () => {
  await assert.rejects(
    checkApprovalPolicy(async () => ({ ok: false, status: 403, text: async () => "forbidden" })),
    /403.*forbidden/,
  );
});

test("workflow scopes the organization token to the consuming run step", async () => {
  const workflow = await readFile(new URL("../.github/workflows/check-actions-approval-policy.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /^    env:\n      GITHUB_ORGANIZATION/m);
  assert.match(workflow, /- run: node scripts\/check-actions-approval-policy\.mjs\n\s+env:\n\s+GITHUB_ORGANIZATION:[\s\S]*ORG_ACTIONS_POLICY_TOKEN/);
});

test("policy workflow cannot dispatch untrusted branch code and uses a protected environment", async () => {
  const workflow = await readFile(new URL("../.github/workflows/check-actions-approval-policy.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.match(workflow, /environment: actions-policy-audit/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
});

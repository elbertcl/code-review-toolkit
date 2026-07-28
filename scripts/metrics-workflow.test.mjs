import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/metrics-dashboard.yml", import.meta.url);

test("metrics workflow is manual-only, least privilege, and fixture-only", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|pull_request:|push:|issues:|issue_comment:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write|id-token: write/);
  assert.match(workflow, /tests\/fixtures\/metrics\/input\.json/);
  assert.match(workflow, /name: metrics-dashboard-sanitized/);
  assert.match(workflow, /retention-days: 1/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|gh api|curl|repository_dispatch|pages/);
});

test("metrics workflow uses immutable action pins", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  for (const match of workflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)) {
    assert.match(match[1], /^[0-9a-f]{40}$/);
  }
});

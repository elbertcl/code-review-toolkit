import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI uses valid pinned setup actions and installs actionlint without a wrapper action", () => {
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(workflow, /go install github\.com\/rhysd\/actionlint\/cmd\/actionlint@v1\.7\.12/);
  assert.doesNotMatch(workflow, /raven-actions\/actionlint/);
});

test("shellcheck accepts legacy compatibility annotations but still fails on warnings", () => {
  assert.match(workflow, /xargs -0 shellcheck -S warning/);
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkActionPins } from "./check-immutable-action-pins.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("accepts only recorded legacy mutable pins outside the hardened lane", async () => {
  const inventory = JSON.parse(await readFile(path.join(root, "docs/legacy-action-pin-exceptions.json"), "utf8"));
  const result = await checkActionPins(root, inventory);
  assert.equal(result.unapproved.length, 0);
  assert.ok(result.exceptions.length > 0);
  assert.ok(result.exceptions.every(({ file }) => file !== "opencode-review/action.yml"));
});

test("never allows mutable refs in the hardened review action", async () => {
  const inventory = [{ file: "opencode-review/action.yml", action: "actions/github-script", ref: "v7" }];
  await assert.rejects(checkActionPins(root, inventory), /hardened lane/);
});

test("recursively discovers action metadata and workflows and hardens the reusable review workflow", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "pins-"));
  await mkdir(path.join(fixture, "nested/action"), { recursive: true });
  await mkdir(path.join(fixture, ".github/workflows"), { recursive: true });
  await writeFile(path.join(fixture, "nested/action/action.yaml"), "runs:\n  using: composite\n  steps:\n    - uses: owner/action@v1\n");
  await writeFile(path.join(fixture, ".github/workflows/opencode-review.yml"), "jobs:\n  x:\n    steps:\n      - uses: owner/action@v1\n");
  const result = await checkActionPins(fixture, [{ file: "nested/action/action.yaml", action: "owner/action", ref: "v1" }]);
  assert.deepEqual(result.unapproved, [{ file: ".github/workflows/opencode-review.yml", action: "owner/action", ref: "v1" }]);
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverReviewContext } from "./context-discovery.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-discovery-"));
  await mkdir(path.join(root, "docs/architecture"), { recursive: true });
  await mkdir(path.join(root, "docs/invariants"), { recursive: true });
  await mkdir(path.join(root, "docs/testspecs/ads"), { recursive: true });
  await mkdir(path.join(root, "docs/conventions"), { recursive: true });
  await mkdir(path.join(root, "docs/arbitrary/deep"), { recursive: true });
  await mkdir(path.join(root, "internal/domain/ads"), { recursive: true });
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "instructions");
  await writeFile(path.join(root, "go.mod"), "module example.test/repo\n");
  await writeFile(path.join(root, "main.go"), "SECRET_SOURCE_TEXT");
  await writeFile(path.join(root, "docs/architecture/ads.md"), "architecture");
  await writeFile(path.join(root, "docs/invariants/ads.md"), "invariants");
  await writeFile(path.join(root, "docs/testspecs/ads/spec.md"), "test spec");
  await writeFile(path.join(root, "docs/conventions/go.md"), "conventions");
  await writeFile(path.join(root, "docs/arbitrary/deep/ignored.md"), "ignored");
  await writeFile(path.join(root, ".github/workflows/ci.yml"), "name: Build and Test\non: pull_request\n");
  return root;
}

test("discovers only bounded context paths and stack indicators", async () => {
  const root = await fixture();
  const result = await discoverReviewContext(root);

  assert.deepEqual(result.instructions, ["AGENTS.md"]);
  assert.deepEqual(result.architecture, ["docs/architecture/ads.md"]);
  assert.deepEqual(result.invariants, ["docs/invariants/ads.md"]);
  assert.deepEqual(result.testspecs, ["docs/testspecs/ads/spec.md"]);
  assert.deepEqual(result.conventions, ["docs/conventions/go.md"]);
  assert.deepEqual(result.workflows, [".github/workflows/ci.yml"]);
  assert.deepEqual(result.stackIndicators, ["go.mod"]);
  assert.deepEqual(result.workflowProposals, [{ name: "Build and Test", path: ".github/workflows/ci.yml", confirmed: false }]);
  assert.deepEqual(result.domains, [{ name: "ads", sourcePaths: ["internal/domain/ads/**"] }]);
  assert.equal(JSON.stringify(result).includes("ignored.md"), false);
  assert.equal(JSON.stringify(result).includes("main.go"), false);
  assert.equal(JSON.stringify(result).includes("SECRET_SOURCE_TEXT"), false);
});

test("discovers only bounded domain roots", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "internal/domain/tracker"), { recursive: true });
  await mkdir(path.join(root, "internal/not-a-domain/ignored"), { recursive: true });

  const result = await discoverReviewContext(root);

  assert.deepEqual(result.domains, [
    { name: "ads", sourcePaths: ["internal/domain/ads/**"] },
    { name: "tracker", sourcePaths: ["internal/domain/tracker/**"] },
  ]);
});

test("does not invent a check name for unnamed or malformed workflows", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".github/workflows/unnamed.yml"), "on: push\n");
  await writeFile(path.join(root, ".github/workflows/other.yaml"), "name: ignored extension\n");

  const result = await discoverReviewContext(root);

  assert.deepEqual(result.workflowProposals, [{ name: "Build and Test", path: ".github/workflows/ci.yml", confirmed: false }]);
});

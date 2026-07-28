import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseManifest, validateManifest } from "./lib/review-manifest.mjs";

const cli = path.join(import.meta.dirname, "initialize-review-context.mjs");
const fixtureRoot = path.resolve(import.meta.dirname, "../tests/fixtures/context-initializer");

async function repo({ optionalGap = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "initialize-context-"));
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await mkdir(path.join(root, "internal/domain/ads"), { recursive: true });
  await writeFile(path.join(root, "go.mod"), "module example.test/repo\n");
  await writeFile(path.join(root, "Makefile"), "lint:\n\t@true\n");
  await writeFile(path.join(root, "AGENTS.md"), "Owner instructions\n");
  await writeFile(path.join(root, ".github/workflows/ci.yml"), "name: Build and Test\non: pull_request\n");
  if (optionalGap) {
    await mkdir(path.join(root, "docs/conventions"), { recursive: true });
    await writeFile(path.join(root, "docs/conventions/go.md"), "ASTRO_REVIEW_CONTEXT_INCOMPLETE\n");
  }
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, "--root", root, ...args], { encoding: "utf8" });
}

test("dry-run reports a proposed diff and verdict without mutating the repository", async () => {
  const root = await repo();
  const result = run(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Proposed changes:/);
  assert.match(result.stdout, /--- \/dev\/null/);
  assert.match(result.stdout, /\+<!-- astro-review-initializer:start -->/);
  assert.match(result.stdout, /REVIEW\.md/);
  assert.match(result.stdout, /Verdict: BLOCKED/);
  await assert.rejects(readFile(path.join(root, "REVIEW.md")), /ENOENT/);
});

test("write creates schema-valid marked context and preserves owner files", async () => {
  const root = await repo();
  const result = run(root, "--write");

  assert.equal(result.status, 0, result.stderr);
  const review = await readFile(path.join(root, "REVIEW.md"), "utf8");
  const manifest = validateManifest(parseManifest(review));
  assert.equal(manifest.profile, "backend");
  assert.deepEqual(manifest.verification_commands, ["OWNER_CONFIRM_VERIFICATION_COMMAND"]);
  assert.deepEqual(manifest.required_checks, [{ name: "OWNER_CONFIRM_REQUIRED_CHECK", category: "test" }]);
  assert.deepEqual(manifest.diff_limits, { changed_files: 1, changed_lines: 1 });
  assert.deepEqual(manifest.conditional_context, [
    { when_changed: ["internal/domain/ads/**"], paths: ["docs/architecture/ads.md"], role: "architecture" },
    { when_changed: ["internal/domain/ads/**"], paths: ["docs/invariants/ads.md"], role: "invariants" },
    { when_changed: ["internal/domain/ads/**"], paths: ["docs/testspecs/ads/spec.md"], role: "testspec" },
  ]);
  assert.doesNotMatch(review, /make lint|Build and Test|github-actions/);
  assert.match(review, /owner confirmation required/i);
  assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), "Owner instructions\n");
  for (const relativePath of [
    "docs/architecture/ads.md",
    "docs/invariants/ads.md",
    "docs/testspecs/ads/spec.md",
  ]) {
    assert.match(await readFile(path.join(root, relativePath), "utf8"), /ASTRO_REVIEW_CONTEXT_INCOMPLETE/);
  }
});

test("write preserves prose outside managed markers and a second run has no diff", async () => {
  const root = await repo();
  await writeFile(path.join(root, "REVIEW.md"), "Owner preface\n\nOwner epilogue\n");

  assert.equal(run(root, "--write").status, 0);
  const first = await readFile(path.join(root, "REVIEW.md"), "utf8");
  assert.match(first, /^Owner preface/);
  assert.match(first, /Owner epilogue/);

  const second = run(root, "--write");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /No changes\./);
  assert.equal(await readFile(path.join(root, "REVIEW.md"), "utf8"), first);
});

test("missing required owner context generates a blocked marked stub", async () => {
  const root = await repo();
  await writeFile(path.join(root, "AGENTS.md"), "ASTRO_REVIEW_CONTEXT_INCOMPLETE\n");

  const result = run(root, "--write");
  assert.match(result.stdout, /Verdict: BLOCKED/);
  assert.match(await readFile(path.join(root, "AGENTS.md"), "utf8"), /ASTRO_REVIEW_CONTEXT_INCOMPLETE/);
});

test("an optional marked gap is ready with gaps after required confirmations", async () => {
  const root = await repo({ optionalGap: true });
  const first = run(root, "--write");
  assert.equal(first.status, 0, first.stderr);
  const reviewPath = path.join(root, "REVIEW.md");
  const review = await readFile(reviewPath, "utf8");
  await writeFile(reviewPath, review.replace("ASTRO_REVIEW_CONTEXT_INCOMPLETE: owner confirmation required", "Owner confirmed discovered CI check name and verification command"));
  await writeFile(path.join(root, "docs/review-dimensions.md"), "# Owner Review Policy\n");
  for (const relativePath of ["docs/architecture/ads.md", "docs/invariants/ads.md", "docs/testspecs/ads/spec.md"]) await writeFile(path.join(root, relativePath), "# Owner-approved domain context\n");

  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verdict: READY_WITH_GAPS/);
});

test("owner-confirmed initializer remains blocked while selected conditional stubs are incomplete", async () => {
  const root = await repo();
  assert.equal(run(root, "--write").status, 0);
  const reviewPath = path.join(root, "REVIEW.md");
  await writeFile(reviewPath, (await readFile(reviewPath, "utf8")).replace("ASTRO_REVIEW_CONTEXT_INCOMPLETE: owner confirmation required", "Owner confirmed discovered CI check name and verification command"));
  await writeFile(path.join(root, "docs/review-dimensions.md"), "# Owner Review Policy\n");
  assert.match(run(root).stdout, /Verdict: BLOCKED/);
});

async function fixture(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `initialize-${name}-`));
  await cp(path.join(fixtureRoot, name), root, { recursive: true });
  return root;
}

test("preserves an existing unmanaged manifest and surrounding prose byte-for-byte", async () => {
  const root = await fixture("existing-unmanaged");
  const reviewPath = path.join(root, "REVIEW.md");
  const before = await readFile(reviewPath, "utf8");

  const result = run(root, "--write");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No changes\./);
  assert.equal(await readFile(reviewPath, "utf8"), before);
  assert.equal((before.match(/astro-review-manifest:start/g) ?? []).length, 1);
});

test("adds exactly one manifest to unmanaged REVIEW.md without changing existing prose bytes", async () => {
  const root = await repo();
  const reviewPath = path.join(root, "REVIEW.md");
  const prose = "Owner preface\n\nOwner epilogue\n";
  await writeFile(reviewPath, prose);

  const result = run(root, "--write");

  assert.equal(result.status, 0, result.stderr);
  const review = await readFile(reviewPath, "utf8");
  assert.ok(review.startsWith(prose));
  assert.equal((review.match(/astro-review-manifest:start/g) ?? []).length, 1);
  assert.equal((review.match(/astro-review-manifest:end/g) ?? []).length, 1);
  assert.match(await readFile(path.join(root, "docs/architecture/ads.md"), "utf8"), /ASTRO_REVIEW_CONTEXT_INCOMPLETE/);
});

test("maps existing domain documents only to bounded conditional context", async () => {
  const root = await repo();
  await mkdir(path.join(root, "docs/architecture"), { recursive: true });
  await mkdir(path.join(root, "docs/invariants"), { recursive: true });
  await mkdir(path.join(root, "docs/testspecs/ads"), { recursive: true });
  await writeFile(path.join(root, "docs/architecture/ads.md"), "Owner architecture\n");
  await writeFile(path.join(root, "docs/invariants/ads.md"), "Owner invariants\n");
  await writeFile(path.join(root, "docs/testspecs/ads/spec.md"), "Owner testspec\n");

  const result = run(root, "--write");

  assert.equal(result.status, 0, result.stderr);
  const manifest = validateManifest(parseManifest(await readFile(path.join(root, "REVIEW.md"), "utf8")));
  assert.deepEqual(manifest.optional_context, []);
  assert.equal(manifest.conditional_context.length, 3);
  assert.equal(await readFile(path.join(root, "docs/architecture/ads.md"), "utf8"), "Owner architecture\n");
});

test("preserves owner-selected values in an existing managed manifest", async () => {
  const root = await fixture("existing-managed");
  const reviewPath = path.join(root, "REVIEW.md");
  const before = await readFile(reviewPath, "utf8");
  const expected = validateManifest(parseManifest(before));

  const first = run(root, "--write");
  const second = run(root, "--write");

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /No changes\./);
  const after = await readFile(reviewPath, "utf8");
  assert.equal(after, before);
  assert.deepEqual(validateManifest(parseManifest(after)), expected);
});

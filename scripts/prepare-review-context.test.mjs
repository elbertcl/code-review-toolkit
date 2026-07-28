import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compileReviewContext } from "./prepare-review-context.mjs";

const toolkitRoot = path.resolve(import.meta.dirname, "..");
const contextsRoot = path.join(toolkitRoot, "contexts");
const fixtureRoot = path.join(toolkitRoot, "tests", "fixtures", "manifest");

function git(workspace, ...args) {
  return execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
}

async function copyFixture(name) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), `review-context-${name}-`));
  execFileSync("cp", ["-R", `${path.join(fixtureRoot, name)}/.`, workspace]);
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@example.com");
  git(workspace, "config", "user.name", "Test");
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "base");
  return workspace;
}

test("compiles org profiles and only exact declared base-ref files", async () => {
  const workspace = await copyFixture("ready");
  const trustedRef = git(workspace, "rev-parse", "HEAD");
  await writeFile(path.join(workspace, "REVIEW.md"), "untrusted head manifest");
  await writeFile(path.join(workspace, "AGENTS.md"), "untrusted head instructions");
  await writeFile(path.join(workspace, "docs/review-dimensions.md"), "untrusted head policy");
  await writeFile(path.join(workspace, "docs/invariants/admanager.md"), "untrusted head invariant");
  await writeFile(path.join(workspace, "undeclared-secret.md"), "DO NOT INCLUDE");
  const outputPath = path.join(workspace, ".opencode/tmp/review_context.md");

  const result = await compileReviewContext({
    workspace,
    trustedRef,
    changedFiles: ["internal/domain/admanager/service.go"],
    orgContextsRoot: contextsRoot,
    outputPath,
    maxBytes: 100_000,
  });
  const output = await readFile(outputPath, "utf8");
  const metadata = JSON.parse(await readFile(path.join(workspace, ".opencode/tmp/review_context.metadata.json")));

  assert.equal(result.status, "READY");
  assert.match(output, /## Source: backend\/security\.md/);
  assert.match(output, /base instructions/);
  assert.match(output, /base policy/);
  assert.match(output, /base invariant/);
  assert.doesNotMatch(output, /untrusted head|DO NOT INCLUDE/);
  assert.equal(metadata.total_bytes, Buffer.byteLength(output));
  assert.deepEqual(metadata.missing_optional_paths, []);
  assert.ok(metadata.sources.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
});

test("uses required, optional, and conditional gap semantics", async () => {
  for (const [fixture, expected] of [
    ["ready-with-gaps", "READY_WITH_GAPS"],
    ["blocked-required-stub", "BLOCKED"],
  ]) {
    const workspace = await copyFixture(fixture);
    const result = await compileReviewContext({
      workspace,
      trustedRef: git(workspace, "rev-parse", "HEAD"),
      changedFiles: ["internal/domain/admanager/service.go"],
      orgContextsRoot: contextsRoot,
      outputPath: path.join(workspace, ".opencode/tmp/review_context.md"),
      maxBytes: 100_000,
    });
    assert.equal(result.status, expected);
  }
});

test("blocks trusted-ref symlinks and never follows the head filesystem", async () => {
  const workspace = await copyFixture("ready");
  await writeFile(path.join(workspace, "outside.md"), "outside");
  await symlink("outside.md", path.join(workspace, "linked.md"));
  const manifestPath = path.join(workspace, "REVIEW.md");
  const manifestText = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, manifestText.replace('"AGENTS.md"', '"linked.md"'));
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "symlink context");

  const result = await compileReviewContext({
    workspace,
    trustedRef: git(workspace, "rev-parse", "HEAD"),
    changedFiles: [],
    orgContextsRoot: contextsRoot,
    outputPath: path.join(workspace, ".opencode/tmp/review_context.md"),
    maxBytes: 100_000,
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /linked\.md.*symlink/);
});

test("blocks instead of truncating oversized context", async () => {
  const workspace = await copyFixture("oversized");
  await assert.rejects(
    compileReviewContext({
      workspace,
      trustedRef: git(workspace, "rev-parse", "HEAD"),
      changedFiles: [],
      orgContextsRoot: contextsRoot,
      outputPath: path.join(workspace, ".opencode/tmp/review_context.md"),
      maxBytes: 80,
    }),
    /exceeds 80 bytes.*backend\/security\.md/s,
  );
});

test("rejects any mandatory organization rule ID in repository policy", async () => {
  const workspace = await copyFixture("ready");
  await writeFile(path.join(workspace, "docs/review-dimensions.md"), "ORG-SEC-001 remains mandatory");
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "unsafe policy");

  await assert.rejects(
    compileReviewContext({
      workspace,
      trustedRef: git(workspace, "rev-parse", "HEAD"),
      changedFiles: [],
      orgContextsRoot: contextsRoot,
      outputPath: path.join(workspace, ".opencode/tmp/review_context.md"),
      maxBytes: 100_000,
    }),
    /must not contain mandatory organization rule ID ORG-SEC-001/,
  );
});

test("policy gaps block compilation and blockers are rendered for consumers", async () => {
  const workspace = await copyFixture("ready");
  await writeFile(path.join(workspace, "docs/review-dimensions.md"), "ASTRO_REVIEW_CONTEXT_INCOMPLETE");
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "stub policy");
  const outputPath = path.join(workspace, ".opencode/tmp/review_context.md");

  const result = await compileReviewContext({
    workspace,
    trustedRef: git(workspace, "rev-parse", "HEAD"),
    changedFiles: [],
    orgContextsRoot: contextsRoot,
    outputPath,
    maxBytes: 100_000,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(await readFile(outputPath, "utf8"), /Status: BLOCKED[\s\S]*Blockers:[\s\S]*docs\/review-dimensions\.md is incomplete/);
});

test("an initializer gap marker in REVIEW.md blocks compilation", async () => {
  const workspace = await copyFixture("ready");
  const manifestPath = path.join(workspace, "REVIEW.md");
  const manifest = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `ASTRO_REVIEW_CONTEXT_INCOMPLETE: owner confirmation required\n\n${manifest}`);
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "incomplete initializer proposal");

  const result = await compileReviewContext({
    workspace,
    trustedRef: git(workspace, "rev-parse", "HEAD"),
    changedFiles: [],
    orgContextsRoot: contextsRoot,
    outputPath: path.join(workspace, ".opencode/tmp/review_context.md"),
    maxBytes: 100_000,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /REVIEW\.md is incomplete/);
});

test("compiled context states organization precedence and metadata retains the manifest contract", async () => {
  const workspace = await copyFixture("ready");
  const outputPath = path.join(workspace, ".opencode/tmp/review_context.md");
  const trustedRef = git(workspace, "rev-parse", "HEAD");
  await compileReviewContext({ workspace, trustedRef, changedFiles: [], orgContextsRoot: contextsRoot, outputPath, maxBytes: 100_000 });

  const output = await readFile(outputPath, "utf8");
  const metadata = JSON.parse(await readFile(path.join(workspace, ".opencode/tmp/review_context.metadata.json")));
  assert.match(output, /Organization rules take precedence over repository policy/);
  assert.equal(metadata.trusted_ref, trustedRef);
  assert.equal(metadata.manifest.schema_version, 1);
  assert.deepEqual(metadata.manifest.diff_limits, { changed_files: 40, changed_lines: 1200 });
  assert.deepEqual(metadata.manifest.required_checks, [{ name: "Build and Test", category: "test" }]);
});

test("rejects symbolic and short trusted refs before reading context", async () => {
  const workspace = await copyFixture("ready");
  for (const trustedRef of ["HEAD", git(workspace, "rev-parse", "--short", "HEAD")]) {
    await assert.rejects(
      compileReviewContext({ workspace, trustedRef, changedFiles: [], orgContextsRoot: contextsRoot, outputPath: path.join(workspace, ".opencode/tmp/review_context.md") }),
      /trustedRef must be a full 40-character commit SHA/,
    );
  }
});

test("manifest wrapper leaves generated output out of git status and prints machine-readable status", async () => {
  const workspace = await copyFixture("ready");
  await mkdir(path.join(workspace, ".opencode"), { recursive: true });
  const changedFilesPath = path.join(workspace, ".opencode/changed-files.json");
  await writeFile(changedFilesPath, "[]");
  const trustedRef = git(workspace, "rev-parse", "HEAD");
  const stdout = execFileSync("bash", [
    path.join(toolkitRoot, "scripts/prepare-review-context.sh"),
    workspace,
    trustedRef,
    changedFilesPath,
    contextsRoot,
    "100000",
  ], { cwd: workspace, encoding: "utf8" });

  assert.equal(git(workspace, "status", "--porcelain"), "");
  assert.match(stdout, /^REVIEW_CONTEXT_STATUS=READY$/m);
});

test("compatibility wrapper preserves the legacy two-argument API and output", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "review-context-legacy-"));
  await mkdir(path.join(workspace, "docs/invariants"), { recursive: true });
  await writeFile(path.join(workspace, "AGENTS.md"), "legacy instructions");
  await writeFile(path.join(workspace, "docs/invariants/admanager.md"), "legacy invariant");
  git(workspace, "init", "-q");
  git(workspace, "config", "user.email", "test@example.com");
  git(workspace, "config", "user.name", "Test");
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "base");
  const fakeBin = await mkdtemp(path.join(os.tmpdir(), "review-context-bin-"));
  await writeFile(path.join(fakeBin, "gh"), "#!/bin/sh\nprintf '%s\\n' internal/domain/admanager/service.go\n", { mode: 0o755 });

  execFileSync("bash", [path.join(toolkitRoot, "scripts/prepare-review-context.sh"), "17", "owner/repo"], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });

  const output = await readFile(path.join(workspace, "review_context.md"), "utf8");
  assert.match(output, /# Review Context \(pre-extracted\)/);
  assert.match(output, /legacy instructions/);
  assert.match(output, /legacy invariant/);
  assert.match(output, /Existing function signatures/);
});

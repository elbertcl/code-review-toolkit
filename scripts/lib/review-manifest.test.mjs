import assert from "node:assert/strict";
import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GAP_MARKER,
  classifyContext,
  globMatches,
  parseManifest,
  resolveContextPath,
  validateManifest,
} from "./review-manifest.mjs";

const validManifest = {
  schema_version: 1,
  profile: "backend",
  organization_profiles: ["backend/security", "backend/sre"],
  policy_path: "docs/review-dimensions.md",
  verification_commands: ["make lint"],
  required_context: [{ path: "AGENTS.md", role: "instructions" }],
  optional_context: [{ path: "docs/testspecs/display/spec.md", role: "testspec" }],
  conditional_context: [{
    when_changed: ["internal/domain/admanager/**"],
    paths: ["docs/architecture/admanager.md", "docs/invariants/admanager.md"],
    role: "invariants",
  }],
  required_checks: [{ name: "Build and Test", category: "test" }],
  diff_limits: { changed_files: 40, changed_lines: 1200 },
  diff_override: {
    label: "ai-review-size-approved",
    authorized_associations: ["OWNER", "MEMBER"],
  },
  docs_only_paths: ["**/*.md", "docs/**"],
  excluded_paths: ["mocks/**", "**/*.pb.go"],
};

function markdown(manifest = validManifest) {
  return `# Review Context\n\n<!-- astro-review-manifest:start -->\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n<!-- astro-review-manifest:end -->\n`;
}

function copyManifest() {
  return structuredClone(validManifest);
}

test("parses exactly one fenced JSON manifest block", () => {
  assert.equal(parseManifest(markdown()).profile, "backend");
  assert.throws(() => parseManifest(`${markdown()}${markdown()}`), /exactly one/);
  assert.throws(() => parseManifest("# no manifest"), /exactly one/);
});

test("validates the exact manifest schema and fixed organization profiles", () => {
  assert.doesNotThrow(() => validateManifest(copyManifest()));

  const unsupported = copyManifest();
  unsupported.profile = "mobile";
  assert.throws(() => validateManifest(unsupported), /profile/);

  const omitted = copyManifest();
  omitted.organization_profiles = ["backend/security"];
  assert.throws(() => validateManifest(omitted), /organization_profiles/);

  const arbitrary = copyManifest();
  arbitrary.organization_profiles[1] = "../../custom";
  assert.throws(() => validateManifest(arbitrary), /organization_profiles/);

  const unknownKey = copyManifest();
  unknownKey.extra = true;
  assert.throws(() => validateManifest(unknownKey), /unknown key/);
});

test("rejects traversal, globs in exact paths, unsafe globs, and duplicate context paths", () => {
  for (const invalidPath of ["../secret", "/etc/passwd", "docs/*.md", "docs/../secret"]) {
    const manifest = copyManifest();
    manifest.required_context[0].path = invalidPath;
    assert.throws(() => validateManifest(manifest), /repository|exact file/);
  }

  const unsafeGlob = copyManifest();
  unsafeGlob.docs_only_paths = ["docs/{a,b}.md"];
  assert.throws(() => validateManifest(unsafeGlob), /glob/);

  const duplicate = copyManifest();
  duplicate.optional_context[0].path = "AGENTS.md";
  assert.throws(() => validateManifest(duplicate), /unique/);
});

test("double-star globs match files at the root and at nested depths", () => {
  assert.equal(globMatches("**/*.md", "README.md"), true);
  assert.equal(globMatches("**/*.md", "docs/guide/README.md"), true);
  assert.equal(globMatches("docs/**", "docs/README.md"), true);
  assert.equal(globMatches("docs/**", "docs/guides/review.md"), true);
  assert.equal(globMatches("docs/**", "README.md"), false);
});

test("validates commands, checks, limits, roles, and conditional paths", () => {
  const emptyChecks = copyManifest();
  emptyChecks.required_checks = [];
  assert.throws(() => validateManifest(emptyChecks), /required_checks/);

  const emptyCommands = copyManifest();
  emptyCommands.verification_commands = [];
  assert.throws(() => validateManifest(emptyCommands), /verification_commands/);

  const badLimit = copyManifest();
  badLimit.diff_limits.changed_lines = 0;
  assert.throws(() => validateManifest(badLimit), /changed_lines/);

  const badRole = copyManifest();
  badRole.required_context[0].role = "secret";
  assert.throws(() => validateManifest(badRole), /role/);

  const noCondition = copyManifest();
  noCondition.conditional_context[0].when_changed = [];
  assert.throws(() => validateManifest(noCondition), /when_changed/);

  const optionalSlug = copyManifest();
  optionalSlug.required_checks.push({ name: "Security", category: "security" });
  assert.doesNotThrow(() => validateManifest(optionalSlug));

  const workflow = copyManifest();
  workflow.required_checks[0] = { name: "Build and Test", category: "test", workflow_file: ".github/workflows/ci.yml", workflow_id: 42 };
  assert.doesNotThrow(() => validateManifest(workflow));
  workflow.required_checks[0].workflow_file = "../evil.yml";
  assert.throws(() => validateManifest(workflow), /workflow_file/);
});

test("resolveContextPath rejects traversal and symlinks", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "manifest-path-"));
  await writeFile(path.join(workspace, "safe.md"), "safe");
  await symlink(path.join(workspace, "safe.md"), path.join(workspace, "link.md"));

  assert.equal(resolveContextPath(workspace, "safe.md"), await realpath(path.join(workspace, "safe.md")));
  assert.throws(() => resolveContextPath(workspace, "../outside"), /inside the repository/);
  assert.throws(() => resolveContextPath(workspace, "link.md"), /symlink/);
});

test("classifies required and selected conditional gaps as blocked", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "manifest-blocked-"));
  await writeFile(path.join(workspace, "AGENTS.md"), GAP_MARKER);
  const result = classifyContext(copyManifest(), workspace, ["internal/domain/admanager/service.go"]);

  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /AGENTS\.md.*incomplete/);
  assert.match(result.blockers.join("\n"), /docs\/architecture\/admanager\.md.*missing/);
});

test("classifies optional missing or stubbed context as ready with gaps", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "manifest-gaps-"));
  await writeFile(path.join(workspace, "AGENTS.md"), "instructions");
  const manifest = copyManifest();
  manifest.conditional_context = [];
  const result = classifyContext(manifest, workspace, []);

  assert.equal(result.status, "READY_WITH_GAPS");
  assert.deepEqual(result.missingOptional, ["docs/testspecs/display/spec.md"]);
});

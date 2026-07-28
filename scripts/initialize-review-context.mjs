#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { discoverReviewContext } from "./lib/context-discovery.mjs";
import { GAP_MARKER, parseManifest, validateManifest } from "./lib/review-manifest.mjs";

const MANAGED_START = "<!-- astro-review-initializer:start -->";
const MANAGED_END = "<!-- astro-review-initializer:end -->";
const CONFIRMATION = `${GAP_MARKER}: owner confirmation required`;

async function textOrEmpty(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function roleFor(file) {
  if (file.startsWith("docs/architecture/")) return "architecture";
  if (file.startsWith("docs/invariants/")) return "invariants";
  if (file.startsWith("docs/testspecs/")) return "testspec";
  return "conventions";
}

function domainContext(discovery) {
  return discovery.domains.flatMap(({ name, sourcePaths }) => [
    { when_changed: sourcePaths, paths: [`docs/architecture/${name}.md`], role: "architecture" },
    { when_changed: sourcePaths, paths: [`docs/invariants/${name}.md`], role: "invariants" },
    { when_changed: sourcePaths, paths: [`docs/testspecs/${name}/spec.md`], role: "testspec" },
  ]);
}

function manifestFor(discovery) {
  const conditional = domainContext(discovery);
  const conditionalPaths = new Set(conditional.flatMap(({ paths }) => paths));
  const optional = [
    ...discovery.architecture, ...discovery.invariants,
    ...discovery.testspecs, ...discovery.conventions,
  ].filter((contextPath) => !conditionalPaths.has(contextPath))
    .map((contextPath) => ({ path: contextPath, role: roleFor(contextPath) }));
  return {
    schema_version: 1,
    profile: discovery.stackIndicators.some((file) => ["package.json"].includes(file)) && !discovery.stackIndicators.includes("go.mod") ? "frontend" : "backend",
    organization_profiles: discovery.stackIndicators.includes("package.json") && !discovery.stackIndicators.includes("go.mod")
      ? ["frontend/security", "frontend/sre"] : ["backend/security", "backend/sre"],
    policy_path: "docs/review-dimensions.md",
    verification_commands: ["OWNER_CONFIRM_VERIFICATION_COMMAND"],
    required_context: [{ path: discovery.instructions[0] ?? "AGENTS.md", role: "instructions" }],
    optional_context: optional,
    conditional_context: conditional,
    required_checks: [{ name: "OWNER_CONFIRM_REQUIRED_CHECK", category: "test" }],
    diff_limits: { changed_files: 1, changed_lines: 1 },
    diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
    docs_only_paths: ["**/*.md", "docs/**"],
    excluded_paths: ["mocks/**", "**/*.pb.go"],
  };
}

function managedBlock(manifest, confirmed) {
  const confirmation = confirmed
    ? "Owner confirmed discovered CI check name and verification command"
    : CONFIRMATION;
  return `${MANAGED_START}\n## Generated Review Context\n\n${confirmation}\n\n` +
    `Discovered CI names are proposals only and require repository-owner confirmation.\n\n` +
    `<!-- astro-review-manifest:start -->\n${"`".repeat(3)}json\n${JSON.stringify(manifest, null, 2)}\n${"`".repeat(3)}\n` +
    `<!-- astro-review-manifest:end -->\n${MANAGED_END}`;
}

function mergeManaged(existing, block) {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + MANAGED_END.length)}`;
  }
  const separator = existing && !existing.endsWith("\n\n") ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
  return `${existing}${separator}${block}\n`;
}

async function ensureStub(root, relativePath, heading) {
  const absolute = path.join(root, relativePath);
  if (await textOrEmpty(absolute)) return false;
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `# ${heading}\n\n${GAP_MARKER}\n`, "utf8");
  return true;
}

function domainStubs(manifest) {
  return manifest.conditional_context.flatMap(({ paths, role }) => paths.map((contextPath) => ({
    path: contextPath,
    heading: `${role[0].toUpperCase()}${role.slice(1)} Review Context`,
  })));
}

async function verdict(root, manifest, reviewText) {
  if (reviewText.includes(CONFIRMATION)) return "BLOCKED";
  const required = [manifest.policy_path, ...manifest.required_context.map(({ path: contextPath }) => contextPath)];
  for (const file of required) {
    const content = await textOrEmpty(path.join(root, file));
    if (!content || content.includes(GAP_MARKER)) return "BLOCKED";
  }
  for (const { paths } of manifest.conditional_context) {
    for (const contextPath of paths) {
      const content = await textOrEmpty(path.join(root, contextPath));
      if (!content || content.includes(GAP_MARKER)) return "BLOCKED";
    }
  }
  for (const { path: contextPath } of manifest.optional_context) {
    const content = await textOrEmpty(path.join(root, contextPath));
    if (!content || content.includes(GAP_MARKER)) return "READY_WITH_GAPS";
  }
  return "READY";
}

export async function initializeReviewContext({ root, write = false }) {
  const discovery = await discoverReviewContext(root);
  const reviewPath = path.join(root, "REVIEW.md");
  const existing = await textOrEmpty(reviewPath);
  const hasManifest = existing.includes("<!-- astro-review-manifest:start -->") || existing.includes("<!-- astro-review-manifest:end -->");
  let manifest;
  let proposed;
  if (hasManifest) {
    manifest = validateManifest(parseManifest(existing));
    proposed = existing;
  } else {
    manifest = validateManifest(manifestFor(discovery));
    proposed = mergeManaged(existing, managedBlock(manifest, false));
  }
  validateManifest(parseManifest(proposed));
  const changes = [];
  if (existing !== proposed) changes.push("REVIEW.md");
  if (!hasManifest) {
    if (!(await textOrEmpty(path.join(root, manifest.required_context[0].path)))) changes.push(manifest.required_context[0].path);
    if (!(await textOrEmpty(path.join(root, manifest.policy_path)))) changes.push(manifest.policy_path);
    for (const stub of domainStubs(manifest)) {
      if (!(await textOrEmpty(path.join(root, stub.path)))) changes.push(stub.path);
    }
  }
  if (write) {
    if (existing !== proposed) await writeFile(reviewPath, proposed, "utf8");
    if (!hasManifest) {
      await ensureStub(root, manifest.required_context[0].path, "Review Instructions");
      await ensureStub(root, manifest.policy_path, "Review Dimensions");
      for (const stub of domainStubs(manifest)) await ensureStub(root, stub.path, stub.heading);
    }
  }
  const status = await verdict(root, manifest, proposed);
  return { status, changes, existing, proposed };
}

function argumentsFor(argv) {
  let root = process.cwd();
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--write") write = true;
    else if (argv[index] === "--root" && argv[index + 1]) root = path.resolve(argv[++index]);
    else throw new Error(`Usage: initialize-review-context.mjs [--root PATH] [--write]`);
  }
  return { root, write };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const options = argumentsFor(process.argv.slice(2));
    const result = await initializeReviewContext(options);
    if (result.changes.length) {
      console.log(`Proposed changes:\n${result.changes.map((file) => `- ${file}`).join("\n")}`);
      if (!options.write && result.existing !== result.proposed) {
        console.log(`--- ${result.existing ? "REVIEW.md" : "/dev/null"}`);
        console.log("+++ REVIEW.md");
        for (const line of result.proposed.split("\n")) console.log(`+${line}`);
      }
    } else {
      console.log("No changes.");
    }
    console.log(`Verdict: ${result.status}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

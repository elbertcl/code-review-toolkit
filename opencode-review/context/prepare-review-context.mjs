import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GAP_MARKER,
  ORGANIZATION_PROFILE_ALLOWLIST,
  parseManifest,
  selectConditionalContext,
  validateManifest,
} from "./lib/review-manifest.mjs";

const MANIFEST_PATH = "REVIEW.md";

function git(workspace, args, encoding = "utf8") {
  return execFileSync("git", ["-C", workspace, ...args], { encoding, maxBuffer: 10 * 1024 * 1024 });
}

function assertSafeGitPath(declaredPath) {
  if (path.isAbsolute(declaredPath) || declaredPath.split(/[\\/]/).includes("..") || declaredPath.includes(":")) {
    throw new Error(`${declaredPath} must be an exact path inside the repository`);
  }
}

export function readAtRef(workspace, trustedRef, declaredPath) {
  assertSafeGitPath(declaredPath);
  let mode;
  try {
    mode = git(workspace, ["ls-tree", trustedRef, "--", declaredPath]).trim().split(/\s+/)[0];
  } catch (error) {
    throw new Error(`${declaredPath} cannot be inspected at trusted ref: ${error.message}`);
  }
  if (!mode) throw new Error(`${declaredPath} is missing at trusted ref`);
  if (mode === "120000") throw new Error(`${declaredPath} is a symlink at trusted ref`);
  if (mode !== "100644" && mode !== "100755") throw new Error(`${declaredPath} is not a regular file at trusted ref`);
  try {
    return git(workspace, ["show", `${trustedRef}:${declaredPath}`]);
  } catch (error) {
    throw new Error(`${declaredPath} cannot be read at trusted ref: ${error.message}`);
  }
}

export function readOrgContext(orgContextsDir, relativePath) {
  assertSafeGitPath(relativePath);
  const absolute = path.resolve(orgContextsDir, relativePath);
  const rootReal = path.resolve(orgContextsDir);
  if (absolute !== rootReal && !absolute.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`${relativePath} resolves outside org contexts dir`);
  }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`${relativePath} is a symlink`);
  if (!stat.isFile()) throw new Error(`${relativePath} is not a regular file`);
  return readFileSync(absolute, "utf8");
}

function parseMandatoryRuleIds(content, sourcePath) {
  const match = content.match(/^mandatory_rule_ids:\s*\[([^\]]*)\]\s*$/m);
  if (!match) throw new Error(`${sourcePath} must declare mandatory_rule_ids`);
  const ids = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !/^ORG-[A-Z]+-\d{3}$/.test(id))) throw new Error(`${sourcePath} has invalid mandatory_rule_ids`);
  return ids;
}

function assertPolicyDoesNotContainMandatoryRules(policy, ruleIds) {
  for (const ruleId of ruleIds) {
    if (policy.includes(ruleId)) throw new Error(`Repository policy must not contain mandatory organization rule ID ${ruleId}`);
  }
}

function sourceSection(sourcePath, content) {
  const hash = createHash("sha256").update(content).digest("hex");
  return {
    path: sourcePath,
    sha256: hash,
    bytes: Buffer.byteLength(content),
    rendered: `## Source: ${sourcePath}\nSHA-256: \`${hash}\`\n\n${content.trimEnd()}\n`,
  };
}

export function buildOpenThreadsSection(openThreads) {
  if (!Array.isArray(openThreads) || openThreads.length === 0) return null;
  const directive =
    "The following reviewer threads are already open on this PR. Do NOT re-flag " +
    "a finding whose (path, line) is listed here unless the diff introduces a new, " +
    "distinct issue at that anchor. Prefer replying to the existing thread over " +
    "opening a duplicate.";
  const lines = openThreads.map((thread) => {
    const excerpt = String(thread.latest_body_excerpt ?? "").slice(0, 300).replace(/\s+/g, " ").trim();
    const author = String(thread.latest_author ?? "unknown");
    return `- ${thread.path}:${thread.line} (last by @${author}): ${excerpt}`;
  });
  const content = `${directive}\n\n${lines.join("\n")}`;
  const hash = createHash("sha256").update(content).digest("hex");
  return {
    path: "pr/open-threads",
    sha256: hash,
    bytes: Buffer.byteLength(content),
    rendered: `## Source: pr/open-threads\nSHA-256: \`${hash}\`\n\n${content}\n`,
  };
}

function assertTrustedCommit(workspace, trustedRef) {
  if (!/^[0-9a-f]{40}$/.test(trustedRef)) throw new Error("trustedRef must be a full 40-character commit SHA");
  try {
    git(workspace, ["cat-file", "-e", `${trustedRef}^{commit}`]);
  } catch {
    throw new Error(`trustedRef ${trustedRef} is not a verified commit`);
  }
}

export async function compileReviewContext({ workspace, trustedRef, changedFiles = [], orgContextsDir, outputPath, maxBytes = 500_000, openThreadsPath }) {
  assertTrustedCommit(workspace, trustedRef);
  const manifestText = readAtRef(workspace, trustedRef, MANIFEST_PATH);
  const manifest = validateManifest(parseManifest(manifestText));
  const sources = [];
  let sourceBytes = 0;
  const addSource = (sourcePath, content) => {
    const source = sourceSection(sourcePath, content);
    sourceBytes += Buffer.byteLength(source.rendered);
    if (sourceBytes > maxBytes) throw new Error(`Compiled review context exceeds ${maxBytes} bytes while adding ${sourcePath}`);
    sources.push(source);
  };
  const mandatoryRuleIds = [];
  for (const profile of manifest.organization_profiles) {
    const relativePath = ORGANIZATION_PROFILE_ALLOWLIST[profile];
    if (!relativePath) throw new Error(`Organization profile ${profile} is not allowlisted`);
    // Org contexts ship inside the action checkout, not the consuming repo.
    // Read them from the action filesystem so a PR branch cannot supply or
    // redefine its own mandatory organization rules. See RULE-RVW-01.
    const content = readOrgContext(orgContextsDir, relativePath);
    mandatoryRuleIds.push(...parseMandatoryRuleIds(content, relativePath));
    addSource(relativePath, content);
  }
  if (new Set(mandatoryRuleIds).size !== mandatoryRuleIds.length) throw new Error("Organization profiles contain duplicate mandatory rule IDs");

  const policy = readAtRef(workspace, trustedRef, manifest.policy_path);
  assertPolicyDoesNotContainMandatoryRules(policy, mandatoryRuleIds);
  const requiredEntries = [...manifest.required_context, ...selectConditionalContext(manifest, changedFiles)];
  const missingOptional = [];
  const blockers = [];
  if (manifestText.includes(GAP_MARKER)) blockers.push(`${MANIFEST_PATH} is incomplete`);
  if (policy.includes(GAP_MARKER)) blockers.push(`${manifest.policy_path} is incomplete`);
  else addSource(manifest.policy_path, policy);
  for (const entry of requiredEntries) {
    try {
      const content = readAtRef(workspace, trustedRef, entry.path);
      if (content.includes(GAP_MARKER)) blockers.push(`${entry.path} is incomplete`);
      else addSource(entry.path, content);
    } catch (error) {
      blockers.push(`${entry.path} is missing or unsafe: ${error.message}`);
    }
  }
  for (const entry of manifest.optional_context) {
    try {
      const content = readAtRef(workspace, trustedRef, entry.path);
      if (content.includes(GAP_MARKER)) missingOptional.push(entry.path);
      else addSource(entry.path, content);
    } catch {
      missingOptional.push(entry.path);
    }
  }
  if (openThreadsPath) {
    let openThreads = [];
    try {
      openThreads = JSON.parse(await readFile(openThreadsPath, "utf8"));
    } catch {
      openThreads = [];
    }
    const threadsSection = buildOpenThreadsSection(openThreads);
    if (threadsSection) {
      sourceBytes += Buffer.byteLength(threadsSection.rendered);
      if (sourceBytes > maxBytes) throw new Error(`Compiled review context exceeds ${maxBytes} bytes while adding pr/open-threads`);
      sources.push(threadsSection);
    }
  }
  const status = blockers.length ? "BLOCKED" : missingOptional.length ? "READY_WITH_GAPS" : "READY";
  const blockerText = blockers.length ? `Blockers:\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}\n\n` : "";
  const output = `# Compiled Review Context\n\nStatus: ${status}\n\nOrganization rules take precedence over repository policy.\n\n${blockerText}${sources.map(({ rendered }) => rendered).join("\n")}`;
  const totalBytes = Buffer.byteLength(output);
  if (totalBytes > maxBytes) {
    const sizes = [...sources].sort((left, right) => right.bytes - left.bytes).map(({ path: sourcePath, bytes }) => `${sourcePath}: ${bytes} bytes`).join("\n");
    throw new Error(`Compiled review context exceeds ${maxBytes} bytes (${totalBytes} bytes)\n${sizes}`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const metadataPath = path.join(path.dirname(outputPath), "review_context.metadata.json");
  const metadata = {
    status,
    trusted_ref: trustedRef,
    profile: manifest.profile,
    manifest,
    sources: sources.map(({ path: sourcePath, sha256, bytes }) => ({ path: sourcePath, sha256, bytes })),
    missing_optional_paths: missingOptional,
    blockers,
    total_bytes: totalBytes,
  };
  await writeFile(outputPath, output);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { ...metadata, missingOptional, blockers };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--") || args[index + 1] === undefined) throw new Error(`Invalid argument ${args[index] ?? ""}`);
    options[args[index].slice(2)] = args[index + 1];
  }
  for (const required of ["workspace", "trusted-ref", "changed-files", "org-contexts-dir", "max-bytes"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  const maxBytes = Number(options["max-bytes"]);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("--max-bytes must be a positive integer");
  return { ...options, maxBytes };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const changedFiles = JSON.parse(await readFile(options["changed-files"], "utf8"));
  if (!Array.isArray(changedFiles) || changedFiles.some((value) => typeof value !== "string")) throw new Error("--changed-files must contain a JSON string array");
  const outputPath = path.join(options.workspace, ".opencode/tmp/review_context.md");
  const result = await compileReviewContext({
    workspace: options.workspace,
    trustedRef: options["trusted-ref"],
    changedFiles,
    orgContextsDir: options["org-contexts-dir"],
    outputPath,
    maxBytes: options.maxBytes,
    openThreadsPath: options["open-threads"],
  });
  process.stdout.write(`REVIEW_CONTEXT_STATUS=${result.status}\n${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseManifest,
  validateManifest,
  mergeWithDefaults,
  classifyContext,
  type Manifest,
  type ManifestDefaults,
} from "./lib/review-manifest.js";

export interface ManifestStatus {
  status: "READY" | "READY_WITH_GAPS" | "BLOCKED";
  fallbackReason: string;
  blockers: string[];
  missingOptional: string[];
  defaultPolicyBody: string;
}

export interface ResolveManifestInput {
  repoManifestPath: string;
  fallbackManifestPath: string;
  defaultsJsonPath: string;
  changedFilesJsonPath: string;
  workspace: string;
}

export interface ResolveManifestResult {
  manifest: Manifest | null;
  status: ManifestStatus;
}

function loadValid(markdownPath: string): Manifest {
  return validateManifest(parseManifest(readFileSync(markdownPath, "utf8")));
}

export function resolveManifest(input: ResolveManifestInput): ResolveManifestResult {
  const blockers: string[] = [];
  const missingOptional: string[] = [];
  let fallbackReason = "";

  let manifest: Manifest;
  if (!existsSync(input.repoManifestPath)) {
    fallbackReason = "REVIEW.md not found in repo";
    manifest = loadValid(input.fallbackManifestPath);
  } else {
    try {
      manifest = loadValid(input.repoManifestPath);
    } catch (error) {
      fallbackReason = "REVIEW.md is invalid: " + (error as Error).message;
      manifest = loadValid(input.fallbackManifestPath);
    }
  }

  let merged: Manifest = manifest;
  try {
    const defaults = JSON.parse(readFileSync(input.defaultsJsonPath, "utf8")) as ManifestDefaults;
    merged = mergeWithDefaults(manifest, defaults);
  } catch (error) {
    blockers.push(`manifest defaults could not be applied: ${(error as Error).message}`);
  }

  let defaultPolicyBody = "";
  try {
    if (!existsSync(join(input.workspace, manifest.policy_path))) {
      const fallbackMd = readFileSync(input.fallbackManifestPath, "utf8");
      const headingIdx = fallbackMd.search(/^# Review Dimensions\s*$/m);
      if (headingIdx >= 0) {
        const after = fallbackMd.slice(fallbackMd.indexOf("\n", headingIdx) + 1);
        const nextH1 = after.search(/^#(?!#)[^\n]*$/m);
        defaultPolicyBody = (nextH1 >= 0 ? after.slice(0, nextH1) : after).trim();
      }
    }
  } catch {
    // defaultPolicyBody is best-effort; empty means the caller runs with empty policy
  }

  try {
    const changedFiles = existsSync(input.changedFilesJsonPath)
      ? (JSON.parse(readFileSync(input.changedFilesJsonPath, "utf8")) as string[])
      : [];
    const classified = classifyContext(merged, input.workspace, changedFiles);
    blockers.push(...classified.blockers);
    missingOptional.push(...classified.missingOptional);
  } catch (error) {
    blockers.push(`context classification failed: ${(error as Error).message}`);
  }

  const status: ManifestStatus["status"] =
    blockers.length > 0 ? "BLOCKED" : missingOptional.length > 0 ? "READY_WITH_GAPS" : "READY";

  return { manifest: merged, status: { status, fallbackReason, blockers, missingOptional, defaultPolicyBody } };
}

if (process.argv[1] && process.argv[1].endsWith("resolve-manifest.js")) {
  const args = process.argv.slice(2);
  const [repoManifestPath, fallbackManifestPath, defaultsJsonPath, changedFilesJsonPath, workspace, outputManifestPath, outputStatusPath] = args;
  if (args.length < 7) {
    process.stderr.write(
      "Usage: node resolve-manifest.js <repoManifest> <fallbackManifest> <defaultsJson> <changedFilesJson> <workspace> <outManifest> <outStatus>\n",
    );
    process.exit(1);
  }
  const result = resolveManifest({ repoManifestPath, fallbackManifestPath, defaultsJsonPath, changedFilesJsonPath, workspace });
  writeFileSync(outputManifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  writeFileSync(outputStatusPath, JSON.stringify(result.status, null, 2) + "\n");
  const tail = result.status.fallbackReason ? ` (fallback: ${result.status.fallbackReason})` : "";
  process.stdout.write(`manifest: ${result.status.status}${tail}\n`);
}

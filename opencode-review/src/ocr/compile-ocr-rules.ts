import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { ORGANIZATION_PROFILE_ALLOWLIST, type Manifest } from "../context/lib/review-manifest.js";

function assertSafeGitPath(declaredPath: string): void {
  if (path.isAbsolute(declaredPath) || declaredPath.split(/[\\/]/).includes("..") || declaredPath.includes(":")) {
    throw new Error(`${declaredPath} must be an exact path inside the repository`);
  }
}

function readOrgBody(orgContextsDir: string, relativePath: string): string {
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

function parseMandatoryRuleIds(content: string, sourcePath: string): string[] {
  const match = content.match(/^mandatory_rule_ids:\s*\[([^\]]*)\]\s*$/m);
  if (!match) throw new Error(`${sourcePath} must declare mandatory_rule_ids`);
  const ids = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !/^ORG-[A-Z]+-\d{3}$/.test(id))) throw new Error(`${sourcePath} has invalid mandatory_rule_ids`);
  return ids;
}

function extractDimensionSummaries(policyBody: string): string {
  const blockMatch = policyBody.match(/## Section \d+: [^\n]*\n\n((?:- [^\n]*\n)*)/g);
  if (!blockMatch || blockMatch.length === 0) return "";
  const summaries: string[] = [];
  for (const block of blockMatch) {
    const headerMatch = block.match(/## Section \d+: ([^\n]*)/);
    const header = headerMatch ? headerMatch[1] : "Review Dimension";
    const items: string[] = [];
    const itemMatches = block.matchAll(/^-\s+\*\*([^*]+)\*\*(.*)/gm);
    for (const item of itemMatches) {
      items.push(`  - ${item[1].trim()}: ${item[2].trim().slice(0, 80)}`);
    }
    if (items.length > 0) summaries.push(`${header}:\n${items.join("\n")}`);
    else summaries.push(header);
  }
  return summaries.join("\n");
}

function buildOrgRulesBlk(orgBodies: Record<string, string>): string {
  const lines: string[] = [];
  const ruleRegex = /-\s*\*\*(ORG-[A-Z]+-\d{3}):\*\*\s*(.*)/g;
  for (const [sourcePath, body] of Object.entries(orgBodies)) {
    const matches = body.matchAll(ruleRegex);
    for (const match of matches) {
      lines.push(`- **${match[1]}:** ${match[2]}`);
    }
  }
  return lines.join("\n");
}

interface BaseRuleOptions {
  orgRulesBlk: string;
  conventionsPaths: string[];
  requiredContextPaths: string[];
  policyDimensions: string;
}

interface OcrRule {
  path: string;
  rule: string;
}

interface CompileOcrRulesInput {
  workspace: string;
  trustedRef: string;
  changedFiles: string[];
  orgContextsDir: string;
  manifest: Manifest;
  policyBody?: string;
  resolvedDirectives?: OcrRule[];
}

interface CompileOcrRulesResult {
  include: string[];
  exclude: string[];
  rules: OcrRule[];
}

function buildBaseRule(options: BaseRuleOptions): OcrRule {
  const { orgRulesBlk, conventionsPaths, requiredContextPaths, policyDimensions } = options;
  const conventionsRef = conventionsPaths.join(", ");
  const contextRef = requiredContextPaths.join(", ");
  let text = `Enforce repo standards. Authoritative context: ${conventionsRef}`;
  if (contextRef) text += `, ${contextRef}`;
  text += `. Review all files against the following dimensions:\n${policyDimensions}\n\nOrganization mandatory rules (override repo policy):\n${orgRulesBlk}`;
  return { path: "internal/**/*.go", rule: text };
}

export function compileOcrRules({ orgContextsDir, manifest, policyBody, resolvedDirectives }: CompileOcrRulesInput): CompileOcrRulesResult {
  const orgBodies: Record<string, string> = {};
  const mandatoryRuleIds: string[] = [];
  for (const profile of manifest.organization_profiles) {
    const relativePath = ORGANIZATION_PROFILE_ALLOWLIST[profile];
    if (!relativePath) throw new Error(`Organization profile ${profile} is not allowlisted`);
    const body = readOrgBody(orgContextsDir, relativePath);
    orgBodies[relativePath] = body;
    mandatoryRuleIds.push(...parseMandatoryRuleIds(body, relativePath));
  }

  const orgRulesBlk = buildOrgRulesBlk(orgBodies);
  const policyDimensions = policyBody ? extractDimensionSummaries(policyBody) : "";

  const conventionsPaths: string[] = [];
  const requiredContextPaths: string[] = [];
  for (const entry of manifest.required_context) {
    if (entry.role === "instructions" || entry.role === "conventions") {
      (entry.role === "conventions" ? conventionsPaths : requiredContextPaths).push(entry.path);
    } else {
      requiredContextPaths.push(entry.path);
    }
  }
  const allRequiredPaths = [...conventionsPaths, ...requiredContextPaths];

  const rules: OcrRule[] = [];

  for (const entry of (manifest.conditional_context ?? [])) {
    const docsRef = entry.paths.join(", ");
    for (const glob of entry.when_changed) {
      rules.push({
        path: glob,
        rule: `Authoritative context: ${docsRef}. Enforce every named RULE-XXX-NN entry in the referenced invariant docs; a direct violation is Critical.\n\nOrganization mandatory rules (override repo policy):\n${orgRulesBlk}\n\nReview dimensions to apply:\n${policyDimensions}`,
      });
    }
  }

  for (const entry of (manifest.review_directives ?? [])) {
    for (const glob of entry.when_changed) {
      rules.push({
        path: glob,
        rule: `${entry.directive}\n\nConventions pointer: ${allRequiredPaths.join(", ")}\n\nOrganization mandatory rules (override repo policy):\n${orgRulesBlk}`,
      });
    }
  }

  rules.push(buildBaseRule({ orgRulesBlk, conventionsPaths: allRequiredPaths, requiredContextPaths: [], policyDimensions }));

  if (resolvedDirectives && resolvedDirectives.length > 0) {
    rules.splice(rules.length - 1, 0, ...resolvedDirectives);
  }

  const include = manifest.profile === "backend"
    ? ["internal/**/*.go", "cmd/**/*.go", "pkg/**/*.go"]
    : ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js"];

  const exclude = [...(manifest.excluded_paths ?? []), "**/*_test.go", "_test.go"];

  return { include, exclude, rules };
}
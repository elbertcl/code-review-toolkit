import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const GAP_MARKER = "ASTRO_REVIEW_CONTEXT_INCOMPLETE";

export interface ContextEntry {
  path: string;
  role: string;
}

export interface RequiredCheck {
  name: string;
  category: string;
  app_slug?: string;
  workflow_file?: string;
  workflow_id?: number;
  allow_skipped?: boolean;
  when_changed?: string[];
}

export interface ConditionalContextEntry {
  when_changed: string[];
  paths: string[];
  role: string;
}

export interface ReviewDirectiveEntry {
  when_changed: string[];
  directive: string;
}

export interface DiffOverride {
  label: string;
  authorized_associations: string[];
}

export interface DiffLimits {
  changed_files: number;
  changed_lines: number;
}

export interface Manifest {
  schema_version: number;
  profile: string;
  organization_profiles: string[];
  policy_path: string;
  verification_commands: string[];
  required_context: ContextEntry[];
  optional_context: ContextEntry[];
  conditional_context: ConditionalContextEntry[];
  required_checks: RequiredCheck[];
  diff_limits: DiffLimits;
  diff_override: DiffOverride;
  docs_only_paths: string[];
  excluded_paths: string[];
  review_directives?: ReviewDirectiveEntry[];
}

const MANIFEST_KEYS = new Set([
  "schema_version", "profile", "organization_profiles", "policy_path",
  "verification_commands", "required_context", "optional_context",
  "conditional_context", "required_checks", "diff_limits", "diff_override",
  "docs_only_paths", "excluded_paths", "review_directives",
]);
const ROLES = new Set([
  "instructions", "policy", "architecture", "invariants", "testspec",
  "conventions", "api-contract",
]);
const CHECK_CATEGORIES = new Set(["test", "security", "policy"]);
const PROFILE_ALLOWLIST: Record<string, string[]> = {
  backend: ["backend/security", "backend/sre"],
  frontend: ["frontend/security", "frontend/sre"],
};

function fail(message: string): never {
  throw new Error(`Invalid review manifest: ${message}`);
}

function requireNonEmptyStrings(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${field} must contain non-empty strings`);
  }
}

function validateExactPath(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    fail(`${field} must be an exact file inside the repository`);
  }
  const segments = value.split(/[\\/]/);
  if (segments.includes("..")) fail(`${field} must be inside the repository`);
  if (/[*?\[\]{}]/.test(value)) fail(`${field} must be an exact file without globs`);
}

function validateGlob(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    fail(`${field} glob must stay inside the repository`);
  }
  if (/[\[\]{}]/.test(value)) fail(`${field} glob cannot use character classes or brace expansion`);
  if (/\*{3,}/.test(value)) fail(`${field} glob may use only * and **`);
}

function validateContextEntry(entry: unknown, field: string): asserts entry is ContextEntry {
  const keys = Object.keys(entry ?? {});
  if (keys.length !== 2 || !keys.includes("path") || !keys.includes("role")) fail(`${field} entries require exactly path and role`);
  const e = entry as ContextEntry;
  validateExactPath(e.path, `${field}.path`);
  if (!ROLES.has(e.role)) fail(`${field}.role is unsupported`);
}

export function globMatches(pattern: string, candidate: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
        continue;
      }
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`).test(candidate);
}

export function parseManifest(markdown: string): unknown {
  const start = "<!-- astro-review-manifest:start -->";
  const end = "<!-- astro-review-manifest:end -->";
  const starts = markdown.split(start).length - 1;
  const ends = markdown.split(end).length - 1;
  if (starts !== 1 || ends !== 1) fail("expected exactly one manifest block");
  const block = markdown.slice(markdown.indexOf(start) + start.length, markdown.indexOf(end));
  const match = block.match(/^\s*```json\s*\n([\s\S]*?)\n```\s*$/);
  if (!match) fail("manifest block must contain one fenced JSON object");
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`manifest JSON cannot be parsed: ${(error as Error).message}`);
  }
}

export function validateManifest(manifest: unknown): Manifest {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest must be an object");
  const m = manifest as Record<string, unknown>;
  for (const key of Object.keys(m)) if (!MANIFEST_KEYS.has(key)) fail(`unknown key ${key}`);
  for (const key of MANIFEST_KEYS) if (!(key in m) && key !== "review_directives") fail(`missing key ${key}`);
  if (m.schema_version !== 1 && m.schema_version !== 2) fail("schema_version must be 1 or 2");
  if ("review_directives" in m && m.schema_version !== 2) fail("review_directives requires schema_version 2");
  if (!(m.profile as string in PROFILE_ALLOWLIST)) fail("profile must be backend or frontend");
  if (JSON.stringify(m.organization_profiles) !== JSON.stringify(PROFILE_ALLOWLIST[m.profile as string])) {
    fail(`organization_profiles must be ${PROFILE_ALLOWLIST[m.profile as string].join(", ")}`);
  }
  validateExactPath(m.policy_path, "policy_path");
  requireNonEmptyStrings(m.verification_commands, "verification_commands");
  if (!Array.isArray(m.required_context) || !Array.isArray(m.optional_context)) fail("context fields must be arrays");
  (m.required_context as unknown[]).forEach((entry) => validateContextEntry(entry, "required_context"));
  (m.optional_context as unknown[]).forEach((entry) => validateContextEntry(entry, "optional_context"));
  if (!Array.isArray(m.conditional_context)) fail("conditional_context must be an array");
  for (const entry of (m.conditional_context as unknown[])) {
    const keys = Object.keys(entry ?? {}).sort().join(",");
    if (keys !== "paths,role,when_changed") fail("conditional_context entries require exactly when_changed, paths, and role");
    const e = entry as ConditionalContextEntry;
    requireNonEmptyStrings(e.when_changed, "conditional_context.when_changed");
    e.when_changed.forEach((glob) => validateGlob(glob, "conditional_context.when_changed"));
    requireNonEmptyStrings(e.paths, "conditional_context.paths");
    e.paths.forEach((contextPath) => validateExactPath(contextPath, "conditional_context.paths"));
    if (!ROLES.has(e.role)) fail("conditional_context.role is unsupported");
  }
  if (!Array.isArray(m.required_checks) || (m.required_checks as unknown[]).length === 0) fail("required_checks must not be empty");
  for (const check of (m.required_checks as unknown[])) {
    const allowed = new Set(["name", "category", "app_slug", "workflow_file", "workflow_id", "allow_skipped", "when_changed"]);
    const c = check as Record<string, unknown>;
    if (!check || Object.keys(c).some((key) => !allowed.has(key))) fail("required_checks contains an unknown key");
    if (typeof c.name !== "string" || !c.name.trim() || !CHECK_CATEGORIES.has(c.category as string)) fail("required_checks name or category is invalid");
    if (c.app_slug !== undefined && (typeof c.app_slug !== "string" || !c.app_slug)) fail("required_checks.app_slug is invalid");
    if (c.workflow_file !== undefined) validateExactPath(c.workflow_file, "required_checks.workflow_file");
    if (c.workflow_file !== undefined && !(c.workflow_file as string).startsWith(".github/workflows/")) fail("required_checks.workflow_file must name a workflow under .github/workflows");
    if (c.workflow_id !== undefined && (!Number.isInteger(c.workflow_id) || (c.workflow_id as number) <= 0)) fail("required_checks.workflow_id is invalid");
    if (c.allow_skipped !== undefined && typeof c.allow_skipped !== "boolean") fail("required_checks.allow_skipped is invalid");
    if (c.when_changed !== undefined) {
      requireNonEmptyStrings(c.when_changed, "required_checks.when_changed");
      (c.when_changed as string[]).forEach((glob) => validateGlob(glob, "required_checks.when_changed"));
    }
  }
  for (const key of ["changed_files", "changed_lines"]) {
    const d = (m.diff_limits as Record<string, unknown>);
    if (!Number.isInteger(d?.[key]) || (d[key] as number) <= 0) fail(`diff_limits.${key} must be a positive integer`);
  }
  if (Object.keys(m.diff_limits ?? {}).sort().join(",") !== "changed_files,changed_lines") fail("diff_limits has invalid keys");
  const d = m.diff_override as Record<string, unknown>;
  if (typeof d?.label !== "string" || !d.label) fail("diff_override.label is required");
  requireNonEmptyStrings(d?.authorized_associations, "diff_override.authorized_associations");
  if (Object.keys(m.diff_override ?? {}).sort().join(",") !== "authorized_associations,label") fail("diff_override has invalid keys");
  if ("review_directives" in m) {
    if (!Array.isArray(m.review_directives)) fail("review_directives must be an array");
    for (const entry of (m.review_directives as unknown[])) {
      const keys = Object.keys(entry ?? {}).sort().join(",");
      if (keys !== "directive,when_changed") fail("review_directives entries require exactly when_changed and directive");
      const e = entry as ReviewDirectiveEntry;
      requireNonEmptyStrings(e.when_changed, "review_directives.when_changed");
      e.when_changed.forEach((glob) => validateGlob(glob, "review_directives.when_changed"));
      if (typeof e.directive !== "string" || !e.directive.trim()) fail("review_directives.directive must be a non-empty string");
    }
  }
  for (const field of ["docs_only_paths", "excluded_paths"]) {
    requireNonEmptyStrings(m[field], field);
    (m[field] as string[]).forEach((glob) => validateGlob(glob, field));
  }
  const p = m as unknown as Manifest;
  const paths = [p.policy_path, ...p.required_context.map(({ path: pp }) => pp), ...p.optional_context.map(({ path: pp }) => pp), ...p.conditional_context.flatMap(({ paths: pp }) => pp)];
  if (new Set(paths).size !== paths.length) fail("all context paths must be unique");
  return p;
}

export function resolveContextPath(workspace: string, declaredPath: string): string {
  validateExactPath(declaredPath, "context path");
  const workspaceReal = realpathSync(workspace);
  const absolutePath = path.resolve(workspaceReal, declaredPath);
  if (absolutePath !== workspaceReal && !absolutePath.startsWith(`${workspaceReal}${path.sep}`)) throw new Error(`${declaredPath} must be inside the repository`);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw new Error(`${declaredPath} is a symlink`);
  const realPath = realpathSync(absolutePath);
  if (realPath !== workspaceReal && !realPath.startsWith(`${workspaceReal}${path.sep}`)) throw new Error(`${declaredPath} resolves outside the repository`);
  if (!stat.isFile()) throw new Error(`${declaredPath} is not a file`);
  return absolutePath;
}

export function selectConditionalContext(manifest: Manifest, changedFiles: string[]): ContextEntry[] {
  return manifest.conditional_context.flatMap((entry) => (
    changedFiles.some((changedFile) => entry.when_changed.some((glob) => globMatches(glob, changedFile)))
      ? entry.paths.map((contextPath) => ({ path: contextPath, role: entry.role }))
      : []
  ));
}

export function selectDirectives(manifest: Manifest, changedFiles: string[]): ReviewDirectiveEntry[] {
  const directives = manifest.review_directives ?? [];
  return directives.flatMap((entry) => (
    changedFiles.some((changedFile) => entry.when_changed.some((glob) => globMatches(glob, changedFile)))
      ? [{ when_changed: entry.when_changed, directive: entry.directive }]
      : []
  ));
}

export interface ClassifyResult {
  status: string;
  required: (ContextEntry & { absolutePath: string })[];
  optional: (ContextEntry & { absolutePath: string })[];
  missingOptional: string[];
  blockers: string[];
}

export function classifyContext(manifest: Manifest, workspace: string, changedFiles: string[]): ClassifyResult {
  validateManifest(manifest);
  const requiredEntries = [...manifest.required_context, ...selectConditionalContext(manifest, changedFiles)];
  const required: (ContextEntry & { absolutePath: string })[] = [];
  const optional: (ContextEntry & { absolutePath: string })[] = [];
  const missingOptional: string[] = [];
  const blockers: string[] = [];
  const inspect = (entry: ContextEntry, isRequired: boolean) => {
    try {
      const absolutePath = resolveContextPath(workspace, entry.path);
      if (readFileSync(absolutePath, "utf8").includes(GAP_MARKER)) {
        if (isRequired) blockers.push(`${entry.path} is incomplete`);
        else missingOptional.push(entry.path);
      } else {
        (isRequired ? required : optional).push({ ...entry, absolutePath });
      }
    } catch (error) {
      if (isRequired) blockers.push(`${entry.path} is missing or unsafe: ${(error as Error).message}`);
      else missingOptional.push(entry.path);
    }
  };
  requiredEntries.forEach((entry) => inspect(entry, true));
  manifest.optional_context.forEach((entry) => inspect(entry, false));
  return {
    status: blockers.length ? "BLOCKED" : missingOptional.length ? "READY_WITH_GAPS" : "READY",
    required,
    optional,
    missingOptional,
    blockers,
  };
}

export const ORGANIZATION_PROFILE_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  "backend/security": "backend/security.md",
  "backend/sre": "backend/sre.md",
  "frontend/security": "frontend/security.md",
  "frontend/sre": "frontend/sre.md",
});
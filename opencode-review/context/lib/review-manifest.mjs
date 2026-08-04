import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const GAP_MARKER = "ASTRO_REVIEW_CONTEXT_INCOMPLETE";

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
const PROFILE_ALLOWLIST = {
  backend: ["backend/security", "backend/sre"],
  frontend: ["frontend/security", "frontend/sre"],
};

function fail(message) {
  throw new Error(`Invalid review manifest: ${message}`);
}

function requireNonEmptyStrings(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${field} must contain non-empty strings`);
  }
}

function validateExactPath(value, field) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    fail(`${field} must be an exact file inside the repository`);
  }
  const segments = value.split(/[\\/]/);
  if (segments.includes("..")) fail(`${field} must be inside the repository`);
  if (/[*?\[\]{}]/.test(value)) fail(`${field} must be an exact file without globs`);
}

function validateGlob(value, field) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    fail(`${field} glob must stay inside the repository`);
  }
  if (/[\[\]{}]/.test(value)) fail(`${field} glob cannot use character classes or brace expansion`);
  if (/\*{3,}/.test(value)) fail(`${field} glob may use only * and **`);
}

function validateContextEntry(entry, field) {
  const keys = Object.keys(entry ?? {});
  if (keys.length !== 2 || !keys.includes("path") || !keys.includes("role")) fail(`${field} entries require exactly path and role`);
  validateExactPath(entry.path, `${field}.path`);
  if (!ROLES.has(entry.role)) fail(`${field}.role is unsupported`);
}

export function globMatches(pattern, candidate) {
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

export function parseManifest(markdown) {
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
    fail(`manifest JSON cannot be parsed: ${error.message}`);
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest must be an object");
  for (const key of Object.keys(manifest)) if (!MANIFEST_KEYS.has(key)) fail(`unknown key ${key}`);
  for (const key of MANIFEST_KEYS) if (!(key in manifest) && key !== "review_directives") fail(`missing key ${key}`);
  if (manifest.schema_version !== 1 && manifest.schema_version !== 2) fail("schema_version must be 1 or 2");
  if ("review_directives" in manifest && manifest.schema_version !== 2) fail("review_directives requires schema_version 2");
  if (!(manifest.profile in PROFILE_ALLOWLIST)) fail("profile must be backend or frontend");
  if (JSON.stringify(manifest.organization_profiles) !== JSON.stringify(PROFILE_ALLOWLIST[manifest.profile])) {
    fail(`organization_profiles must be ${PROFILE_ALLOWLIST[manifest.profile].join(", ")}`);
  }
  validateExactPath(manifest.policy_path, "policy_path");
  requireNonEmptyStrings(manifest.verification_commands, "verification_commands");
  if (!Array.isArray(manifest.required_context) || !Array.isArray(manifest.optional_context)) fail("context fields must be arrays");
  manifest.required_context.forEach((entry) => validateContextEntry(entry, "required_context"));
  manifest.optional_context.forEach((entry) => validateContextEntry(entry, "optional_context"));
  if (!Array.isArray(manifest.conditional_context)) fail("conditional_context must be an array");
  for (const entry of manifest.conditional_context) {
    const keys = Object.keys(entry ?? {}).sort().join(",");
    if (keys !== "paths,role,when_changed") fail("conditional_context entries require exactly when_changed, paths, and role");
    requireNonEmptyStrings(entry.when_changed, "conditional_context.when_changed");
    entry.when_changed.forEach((glob) => validateGlob(glob, "conditional_context.when_changed"));
    requireNonEmptyStrings(entry.paths, "conditional_context.paths");
    entry.paths.forEach((contextPath) => validateExactPath(contextPath, "conditional_context.paths"));
    if (!ROLES.has(entry.role)) fail("conditional_context.role is unsupported");
  }
  if (!Array.isArray(manifest.required_checks) || manifest.required_checks.length === 0) fail("required_checks must not be empty");
  for (const check of manifest.required_checks) {
    const allowed = new Set(["name", "category", "app_slug", "workflow_file", "workflow_id", "allow_skipped", "when_changed"]);
    if (!check || Object.keys(check).some((key) => !allowed.has(key))) fail("required_checks contains an unknown key");
    if (typeof check.name !== "string" || !check.name.trim() || !CHECK_CATEGORIES.has(check.category)) fail("required_checks name or category is invalid");
    if (check.app_slug !== undefined && (typeof check.app_slug !== "string" || !check.app_slug)) fail("required_checks.app_slug is invalid");
    if (check.workflow_file !== undefined) validateExactPath(check.workflow_file, "required_checks.workflow_file");
    if (check.workflow_file !== undefined && !check.workflow_file.startsWith(".github/workflows/")) fail("required_checks.workflow_file must name a workflow under .github/workflows");
    if (check.workflow_id !== undefined && (!Number.isInteger(check.workflow_id) || check.workflow_id <= 0)) fail("required_checks.workflow_id is invalid");
    if (check.allow_skipped !== undefined && typeof check.allow_skipped !== "boolean") fail("required_checks.allow_skipped is invalid");
    if (check.when_changed !== undefined) {
      requireNonEmptyStrings(check.when_changed, "required_checks.when_changed");
      check.when_changed.forEach((glob) => validateGlob(glob, "required_checks.when_changed"));
    }
  }
  for (const key of ["changed_files", "changed_lines"]) {
    if (!Number.isInteger(manifest.diff_limits?.[key]) || manifest.diff_limits[key] <= 0) fail(`diff_limits.${key} must be a positive integer`);
  }
  if (Object.keys(manifest.diff_limits ?? {}).sort().join(",") !== "changed_files,changed_lines") fail("diff_limits has invalid keys");
  if (typeof manifest.diff_override?.label !== "string" || !manifest.diff_override.label) fail("diff_override.label is required");
  requireNonEmptyStrings(manifest.diff_override?.authorized_associations, "diff_override.authorized_associations");
  if (Object.keys(manifest.diff_override ?? {}).sort().join(",") !== "authorized_associations,label") fail("diff_override has invalid keys");
  if ("review_directives" in manifest) {
    if (!Array.isArray(manifest.review_directives)) fail("review_directives must be an array");
    for (const entry of manifest.review_directives) {
      const keys = Object.keys(entry ?? {}).sort().join(",");
      if (keys !== "directive,when_changed") fail("review_directives entries require exactly when_changed and directive");
      requireNonEmptyStrings(entry.when_changed, "review_directives.when_changed");
      entry.when_changed.forEach((glob) => validateGlob(glob, "review_directives.when_changed"));
      if (typeof entry.directive !== "string" || !entry.directive.trim()) fail("review_directives.directive must be a non-empty string");
    }
  }
  for (const field of ["docs_only_paths", "excluded_paths"]) {
    requireNonEmptyStrings(manifest[field], field);
    manifest[field].forEach((glob) => validateGlob(glob, field));
  }
  const paths = [manifest.policy_path, ...manifest.required_context.map(({ path: p }) => p), ...manifest.optional_context.map(({ path: p }) => p), ...manifest.conditional_context.flatMap(({ paths: p }) => p)];
  if (new Set(paths).size !== paths.length) fail("all context paths must be unique");
  return manifest;
}

export function resolveContextPath(workspace, declaredPath) {
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

export function selectConditionalContext(manifest, changedFiles) {
  return manifest.conditional_context.flatMap((entry) => (
    changedFiles.some((changedFile) => entry.when_changed.some((glob) => globMatches(glob, changedFile)))
      ? entry.paths.map((contextPath) => ({ path: contextPath, role: entry.role }))
      : []
  ));
}

export function classifyContext(manifest, workspace, changedFiles) {
  validateManifest(manifest);
  const requiredEntries = [...manifest.required_context, ...selectConditionalContext(manifest, changedFiles)];
  const required = [];
  const optional = [];
  const missingOptional = [];
  const blockers = [];
  const inspect = (entry, isRequired) => {
    try {
      const absolutePath = resolveContextPath(workspace, entry.path);
      if (readFileSync(absolutePath, "utf8").includes(GAP_MARKER)) {
        if (isRequired) blockers.push(`${entry.path} is incomplete`);
        else missingOptional.push(entry.path);
      } else {
        (isRequired ? required : optional).push({ ...entry, absolutePath });
      }
    } catch (error) {
      if (isRequired) blockers.push(`${entry.path} is missing or unsafe: ${error.message}`);
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

export const ORGANIZATION_PROFILE_ALLOWLIST = Object.freeze({
  "backend/security": "backend/security.md",
  "backend/sre": "backend/sre.md",
  "frontend/security": "frontend/security.md",
  "frontend/sre": "frontend/sre.md",
});

# Enforce Manifest Defaults & Required-Context Blocking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-implemented-but-never-called `mergeWithDefaults` and `classifyContext` into the OCR review runtime so the documented LOCKED/BOUNDED tiering and required-context fail-closed contract are actually enforced.

**Architecture:** A new `resolve-manifest.ts` CLI module consolidates three things the "Compile review rules" step currently does inline (and two it skips): (1) repo-vs-org-default fallback resolution, (2) `mergeWithDefaults` to apply LOCKED/BOUNDED toolkit defaults, (3) `classifyContext` to fail-closed when required context is missing. It writes `/tmp/resolved-manifest.json` (merged manifest for the compiler) and `/tmp/manifest-status.json` (status + blockers + missing-optional + fallback reason). The action step then aborts on `BLOCKED` (respecting the existing `fail_closed_context` input) or compiles from the merged manifest. The verdict comment surfaces status + missing optional context.

**Tech Stack:** TypeScript (ESM, `node --test`), GitHub Composite Action, no new dependencies.

**Repo:** `elbertcl/code-review-toolkit` (this repo). Build = `tsc` → committed `opencode-review/dist/`. Tests run against compiled dist: `npm test`.

**Two gaps this closes (from the 2026-08-07 audit):**
- **Gap A (High):** `mergeWithDefaults` is implemented + unit-tested but never called at runtime → `manifest-defaults.json` is dead in production; LOCKED/BOUNDED ceilings are unenforced.
- **Gap B (High):** `classifyContext` is implemented but never called → a missing `required_context` file does not block the review; required/optional collapse to "ignored". The `fail_closed_context` action input (already declared, default `"true"`) is currently a no-op.

**Bonus latent bug fixed in passing:** in the current "Compile review rules" step, `ORG_PROFILES_INPUT` is a bash variable that is never exported, so the inline `node -e` reads `process.env.ORG_PROFILES_INPUT` as `undefined` → org profiles silently load as `[]` → **org mandatory rules are not applied today**. We fix this by moving `ORG_PROFILES_INPUT` into the step `env:` map.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `opencode-review/src/context/resolve-manifest.ts` | Pure `resolveManifest()` + CLI wrapper: fallback → merge defaults → classify context → write 2 artifacts | **Create** |
| `opencode-review/src/context/resolve-manifest.test.ts` | Unit tests for `resolveManifest()` across READY / READY_WITH_GAPS / BLOCKED / fallback / merge-error paths | **Create** |
| `opencode-review/src/ocr/post-findings.ts` | `buildVerdictComment` gains `manifestStatus` to surface status + missing-optional in the Context block | **Modify** (`136-178`) |
| `opencode-review/src/ocr/post-findings.test.ts` | Test verdict comment includes status + missing optional lines | **Modify** |
| `opencode-review/action.yml` | "Compile review rules" step calls `resolve-manifest.js`, handles BLOCKED, compiles from resolved manifest; "Post review findings" reads `manifest-status.json` | **Modify** (`536-599`, `625-730`) |
| `opencode-review/context/defaults/manifest-defaults.json` | Unchanged (now actually loaded at runtime) | — |
| `README.md` | Correct "Tiered defaults" + skill-advice accuracy | **Modify** (`135-146`) |
| `skills/initialize-review-context/SKILL.md` | Correct the "omit to inherit" advice (fields are required-but-bounded, not omittable) | **Modify** (`34-42`) |

**Consumer repo (`astronautsid/astro-ads-be`) follow-up (Task 6):**
- `REVIEW.md` — remove the now-redundant `review_directives` entry (it inherits from toolkit defaults); decide `fail_closed_context` setting until missing `tracker.md`/`insight.md` docs exist.

---

## Task 1: `resolve-manifest.ts` — pure function + CLI wrapper (closes Gap A + Gap B core)

**Files:**
- Create: `opencode-review/src/context/resolve-manifest.ts`
- Test: `opencode-review/src/context/resolve-manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `opencode-review/src/context/resolve-manifest.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveManifest } from "./resolve-manifest.js";

// A complete, valid manifest markdown string (all LOCKED/BOUNDED keys present so it validates).
function manifestMarkdown(overrides: Record<string, unknown> = {}): string {
  const base = {
    schema_version: 2,
    policy_path: "docs/policy.md",
    verification_commands: ["make lint"],
    required_context: [{ path: "AGENTS.md", role: "instructions" }],
    optional_context: [],
    conditional_context: [],
    required_checks: [{ name: "PR Checks", category: "test" }],
    diff_limits: { changed_files: 50, changed_lines: 2000 },
    diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
    docs_only_paths: ["docs/**"],
    excluded_paths: ["mocks/**"],
    ...overrides,
  };
  return `# Review Manifest\n\n<!-- astro-review-manifest:start -->\n\`\`\`json\n${JSON.stringify(base, null, 2)}\n\`\`\`\n<!-- astro-review-manifest:end -->\n`;
}

const DEFAULTS_JSON = JSON.stringify({
  locked: {
    excluded_paths: ["mocks/**", "vendor/**"],
    diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
    review_directives: [{ when_changed: ["internal/**/db/**"], directive: "do not refactor DB" }],
  },
  bounded: {
    diff_limits: { changed_files: 100, changed_lines: 5000 },
    docs_only_paths: ["**/*.md", "docs/**"],
  },
});

interface Fixture {
  workspace: string;
  repoManifest: string;
  fallbackManifest: string;
  defaultsJson: string;
  changedFilesJson: string;
}

function makeFixture(manifestMd: string, files: Record<string, string> = {}, changedFiles: string[] = []): Fixture {
  const workspace = mkdtempSync(join(tmpdir(), "rm-ws-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(workspace, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  writeFileSync(join(workspace, "REVIEW.md"), manifestMd);
  const repoManifest = join(workspace, "REVIEW.md");
  const fallbackManifest = join(workspace, "fallback-REVIEW.md");
  writeFileSync(fallbackManifest, manifestMarkdown());
  const defaultsJson = join(workspace, "defaults.json");
  writeFileSync(defaultsJson, DEFAULTS_JSON);
  const changedFilesJson = join(workspace, "changed-files.json");
  writeFileSync(changedFilesJson, JSON.stringify(changedFiles));
  return { workspace, repoManifest, fallbackManifest, defaultsJson, changedFilesJson };
}

describe("resolveManifest", () => {
  let dirs: string[] = [];
  const cleanup = () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; };
  after(cleanup);

  it("READY when repo manifest valid and required context present", () => {
    const f = makeFixture(manifestMarkdown(), { "AGENTS.md": "# agents" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.equal(r.status.status, "READY");
    assert.equal(r.status.fallbackReason, "");
    assert.deepEqual(r.status.blockers, []);
    assert.ok(r.manifest, "merged manifest returned");
  });

  it("uses fallback + sets reason when repo REVIEW.md missing", () => {
    const f = makeFixture(manifestMarkdown(), { "AGENTS.md": "# agents" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: join(f.workspace, "MISSING.md"), fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.equal(r.status.status, "READY");
    assert.match(r.status.fallbackReason, /not found in repo/);
  });

  it("uses fallback + sets reason when repo REVIEW.md invalid", () => {
    const f = makeFixture("not a manifest at all", { "AGENTS.md": "# agents" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.match(r.status.fallbackReason, /REVIEW.md is invalid/);
  });

  it("BLOCKED when a required_context file is missing", () => {
    // required_context references AGENTS.md but we do not create it
    const f = makeFixture(manifestMarkdown(), {});
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.equal(r.status.status, "BLOCKED");
    assert.ok(r.status.blockers.some((b) => /AGENTS\.md/.test(b)));
  });

  it("BLOCKED when a required_context file is a gap stub (sentinel)", () => {
    const f = makeFixture(manifestMarkdown(), { "AGENTS.md": "ASTRO_REVIEW_CONTEXT_INCOMPLETE\nneeds owner input" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.equal(r.status.status, "BLOCKED");
    assert.ok(r.status.blockers.some((b) => /AGENTS\.md is incomplete/));
  });

  it("READY_WITH_GAPS when an optional_context file is missing", () => {
    const md = manifestMarkdown({ optional_context: [{ path: "docs/extra.md", role: "instructions" }] });
    const f = makeFixture(md, { "AGENTS.md": "# agents" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.equal(r.status.status, "READY_WITH_GAPS");
    assert.deepEqual(r.status.missingOptional, ["docs/extra.md"]);
  });

  it("BLOCKED when repo diff_limits exceeds the toolkit ceiling (merge enforces)", () => {
    const md = manifestMarkdown({ diff_limits: { changed_files: 999, changed_lines: 2000 } });
    const f = makeFixture(md, { "AGENTS.md": "# agents" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.equal(r.status.status, "BLOCKED");
    assert.ok(r.status.blockers.some((b) => /exceeds org ceiling/));
  });

  it("merged manifest has LOCKED excluded_paths unioned with defaults", () => {
    const md = manifestMarkdown({ excluded_paths: ["extra/**"] });
    const f = makeFixture(md, { "AGENTS.md": "# agents" });
    dirs.push(f.workspace);
    const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
    assert.ok(r.manifest!.excluded_paths.includes("mocks/**"));
    assert.ok(r.manifest!.excluded_paths.includes("vendor/**"));
    assert.ok(r.manifest!.excluded_paths.includes("extra/**"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './resolve-manifest.js'` (the module does not exist yet).

- [ ] **Step 3: Implement `resolve-manifest.ts`**

Create `opencode-review/src/context/resolve-manifest.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

  // 1. Resolve repo manifest vs org-default fallback (fail-open to defaults, never to "no rules").
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

  // 2. Merge toolkit LOCKED/BOUNDED defaults (enforces ceilings; throws on violation).
  let merged: Manifest = manifest;
  try {
    const defaults = JSON.parse(readFileSync(input.defaultsJsonPath, "utf8")) as ManifestDefaults;
    merged = mergeWithDefaults(manifest, defaults);
  } catch (error) {
    blockers.push(`manifest defaults could not be applied: ${(error as Error).message}`);
  }

  // 3. Classify required vs optional context (fail-closed on missing/incomplete required).
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

  return { manifest: merged, status: { status, fallbackReason, blockers, missingOptional } };
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 8 `resolveManifest` cases pass, plus all pre-existing tests.

- [ ] **Step 5: Build and verify no dist drift**

Run: `npm run build && npm run check-dist`
Expected: `check-dist` passes (the new `dist/context/resolve-manifest.js` + `.test.js` are staged cleanly).

- [ ] **Step 6: Commit**

```bash
git add opencode-review/src/context/resolve-manifest.ts opencode-review/src/context/resolve-manifest.test.ts opencode-review/dist/context/resolve-manifest.js opencode-review/dist/context/resolve-manifest.test.js
git commit -m "feat(review): add resolve-manifest module to enforce defaults + context blocking"
```

---

## Task 2: Wire `resolve-manifest` into the "Compile review rules" step

**Files:**
- Modify: `opencode-review/action.yml` — replace the inline fallback/merge logic in the "Compile review rules" step (`536-599`).

This task has no TS unit test (it is orchestration in YAML). Verification is `action.yml` validity + a local dry run of the node CLI against a fixture.

- [ ] **Step 1: Replace the "Compile review rules" step body**

In `opencode-review/action.yml`, replace the entire step whose `name: Compile review rules` (currently lines `536-599`) with:

```yaml
    - name: Compile review rules
      if: |
        steps.pr-info.outputs.skip == 'false' &&
        steps.preflight.outputs.skip != 'true' &&
        steps.loop_guard.outputs.skip != 'true' &&
        steps.security.outputs.skip != 'true'
      shell: bash
      env:
        GH_TOKEN: ${{ github.token }}
        SERENA_STATUS: ${{ steps.serena.outputs.status }}
        ORG_PROFILES_INPUT: ${{ inputs.org_profiles }}
        FAIL_CLOSED_CONTEXT: ${{ inputs.fail_closed_context }}
      run: |
        ORG_PROFILES_INPUT="${{ inputs.org_profiles }}"
        if [ -z "${ORG_PROFILES_INPUT}" ]; then
          echo "::error::org_profiles is required. Valid values: backend/security, backend/sre, frontend/security, frontend/sre."
          gh pr comment "${{ inputs.issue_number || github.event.issue.number }}" \
            --repo "${{ github.repository }}" \
            --body "**Review aborted:** missing required org_profiles input."
          exit 1
        fi
        export ORG_PROFILES_INPUT
        node "${{ github.action_path }}/dist/context/resolve-manifest.js" \
          "REVIEW.md" \
          "${{ github.action_path }}/context/defaults/REVIEW.md" \
          "${{ github.action_path }}/context/defaults/manifest-defaults.json" \
          "${RUNNER_TEMP}/changed-files.json" \
          "$PWD" \
          "/tmp/resolved-manifest.json" \
          "/tmp/manifest-status.json"
        STATUS=$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/manifest-status.json','utf8')).status")
        if [ "$STATUS" = "BLOCKED" ] && [ "${FAIL_CLOSED_CONTEXT}" = "true" ]; then
          BODY=$(node -e "const s=JSON.parse(require('fs').readFileSync('/tmp/manifest-status.json','utf8'));process.stdout.write('**Review aborted:** required review context is missing or invalid. Fix these and re-run \`/review-ocr\`:\n\n'+s.blockers.map(b=>'- '+b).join('\n'))")
          gh pr comment "${{ inputs.issue_number || github.event.issue.number }}" \
            --repo "${{ github.repository }}" \
            --body "$BODY"
          exit 1
        fi
        node --input-type=module -e "
          import { compileOcrRules } from '\${{ github.action_path }}/dist/ocr/compile-ocr-rules.js';
          import { readFileSync, writeFileSync, existsSync } from 'node:fs';
          const manifest = JSON.parse(readFileSync('/tmp/resolved-manifest.json', 'utf8'));
          const policyBody = existsSync(manifest.policy_path) ? readFileSync(manifest.policy_path, 'utf8') : '';
          let resolvedDirectives = [];
          if (existsSync('/tmp/resolved-directives.json')) {
            resolvedDirectives = JSON.parse(readFileSync('/tmp/resolved-directives.json', 'utf8'));
          }
          const orgProfiles = process.env.ORG_PROFILES_INPUT.split(',').map(p => p.trim()).filter(Boolean);
          const rules = compileOcrRules({
            workspace: process.cwd(),
            changedFiles: [],
            orgContextsDir: '\${{ github.action_path }}/context/contexts',
            manifest,
            policyBody,
            resolvedDirectives,
            orgProfiles,
          });
          writeFileSync(process.env.RUNNER_TEMP + '/ocr-rule.json', JSON.stringify(rules, null, 2) + '\n');
        "
        FALLBACK_REASON=$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/manifest-status.json','utf8')).fallbackReason || ''")
        if [ -n "${FALLBACK_REASON}" ]; then
          SERENA="${SERENA_STATUS:-unavailable}"
          gh pr comment "${{ inputs.issue_number || github.event.issue.number }}" \
            --repo "${{ github.repository }}" \
            --body "⚠️ **Review ran with ORG-DEFAULT rules only.** Serena: ${SERENA}. Your repo \`REVIEW.md\` was not applied: ${FALLBACK_REASON}. Repo-specific rules (conditional invariants, testspecs, review_directives) did **not** apply this run. Fix \`REVIEW.md\` to restore them."
        fi
```

Key changes vs. the old inline script:
1. Calls `resolve-manifest.js` instead of doing fallback + validate inline.
2. `mergeWithDefaults` now actually runs (inside `resolve-manifest`).
3. `classifyContext` now actually runs; `BLOCKED` + `fail_closed_context=true` aborts with a comment.
4. `ORG_PROFILES_INPUT` is exported via the `env:` map → fixes the latent bug where org profiles loaded as `[]`.
5. The compiler reads the merged `/tmp/resolved-manifest.json`.

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('opencode-review/action.yml')); print('action.yml OK')"`
Expected: `action.yml OK` (no YAML syntax errors).

- [ ] **Step 3: Dry-run the resolve-manifest CLI locally against a fixture**

Run:
```bash
TMP=$(mktemp -d)
printf '# agents\n' > "$TMP/AGENTS.md"
node opencode-review/dist/context/resolve-manifest.js \
  "$TMP/REVIEW.md" \
  "$(pwd)/opencode-review/context/defaults/REVIEW.md" \
  "$(pwd)/opencode-review/context/defaults/manifest-defaults.json" \
  "$TMP/changed-files.json" \
  "$TMP" \
  "$TMP/out-manifest.json" "$TMP/out-status.json" \
  && echo "---STATUS---" && cat "$TMP/out-status.json"
rm -rf "$TMP"
```
Expected: stdout prints `manifest: READY_WITH_GAPS` (or `BLOCKED` because the org-default fallback requires `AGENTS.md`, which exists, plus `docs/review-dimensions.md` is referenced by `policy_path` but policy is not a context entry — so classify sees only `AGENTS.md` required → present → `READY`; if your temp dir lacks nothing else, expect `READY`). The status JSON must be valid JSON with `status`, `fallbackReason`, `blockers`, `missingOptional`.

- [ ] **Step 4: Commit**

```bash
git add opencode-review/action.yml
git commit -m "feat(review): enforce manifest defaults + required-context blocking in compile step"
```

---

## Task 3: Surface manifest status + missing optional in the verdict comment

**Files:**
- Modify: `opencode-review/src/ocr/post-findings.ts` (`136-178`)
- Modify: `opencode-review/src/ocr/post-findings.test.ts`
- Modify: `opencode-review/action.yml` "Post review findings" step (`711-724`)

- [ ] **Step 1: Write the failing test**

In `opencode-review/src/ocr/post-findings.test.ts`, add (inside the existing `describe` or a new one — match the file's existing style):

```ts
import { buildVerdictComment } from "./post-findings.js";

describe("buildVerdictComment manifest status", () => {
  it("shows READY when manifestStatus omitted (back-compat)", () => {
    const body = buildVerdictComment({ findings: [], headSha: "abc", verdictMarker: "<!-- v -->", headMarker: "<!-- h:" });
    assert.match(body, /REVIEW\.md: loaded/);
    assert.doesNotMatch(body, /Context status/);
  });

  it("shows fallback reason when provided", () => {
    const body = buildVerdictComment({
      findings: [], headSha: "abc", verdictMarker: "<!-- v -->", headMarker: "<!-- h:",
      manifestStatus: { fallbackReason: "REVIEW.md not found in repo" },
    });
    assert.match(body, /REVIEW\.md: not loaded \(REVIEW\.md not found in repo\)/);
  });

  it("shows READY_WITH_GAPS + missing optional list", () => {
    const body = buildVerdictComment({
      findings: [], headSha: "abc", verdictMarker: "<!-- v -->", headMarker: "<!-- h:",
      manifestStatus: { status: "READY_WITH_GAPS", missingOptional: ["docs/extra.md", "docs/x.md"] },
    });
    assert.match(body, /Context status: READY_WITH_GAPS/);
    assert.match(body, /Missing optional context: docs\/extra\.md, docs\/x\.md/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `manifestStatus` not accepted by `buildVerdictComment`; `Context status` text not present.

- [ ] **Step 3: Extend `buildVerdictComment`**

In `opencode-review/src/ocr/post-findings.ts`, replace the `BuildVerdictInput` interface and `buildVerdictComment` (`136-178`) with:

```ts
interface ManifestStatusInfo {
  fallbackReason?: string;
  status?: "READY" | "READY_WITH_GAPS" | "BLOCKED";
  missingOptional?: string[];
}

interface BuildVerdictInput {
  findings: Finding[];
  headSha: string;
  verdictMarker: string;
  headMarker: string;
  serenaStatus?: string;
  manifestFallbackReason?: string;
  manifestStatus?: ManifestStatusInfo;
}

export function buildVerdictComment({ findings, headSha, verdictMarker, headMarker, serenaStatus, manifestFallbackReason, manifestStatus }: BuildVerdictInput): string {
  const criticalCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "CRITICAL").length;
  const highCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "HIGH").length;
  const mediumCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "MEDIUM").length;
  const lowCount = findings.filter((f) => (f.severity ?? "").toUpperCase() === "LOW").length;
  const total = findings.length;
  const verdict = criticalCount > 0 || highCount > 0 ? "FAIL" : "PASS";

  const items = findings.map((f) => ({
    severity: f.severity ?? "INFO",
    path: f.path,
    line: f.line ?? f.start_line ?? f.end_line ?? 0,
    title: (f.message || f.content || "").split(".")[0] || f.message || f.content || "",
    body: f.message || f.content || "",
    suggested_fix: "",
  }));

  const serenaLabel = serenaStatus === "available" ? "available" : "not available";
  const reason = manifestStatus?.fallbackReason ?? manifestFallbackReason ?? "";
  const reviewMdLabel = reason ? `not loaded (${reason})` : "loaded";

  const contextLines = [`- Serena: ${serenaLabel}`, `- REVIEW.md: ${reviewMdLabel}`];
  if (manifestStatus?.status) {
    contextLines.push(`- Context status: ${manifestStatus.status}`);
  }
  if (manifestStatus?.missingOptional && manifestStatus.missingOptional.length > 0) {
    contextLines.push(`- Missing optional context: ${manifestStatus.missingOptional.join(", ")}`);
  }

  return `## Review Verdict

**Context:**
${contextLines.join("\n")}

**Verdict: ${verdict}** — ${total} finding${total !== 1 ? "s" : ""} (${criticalCount} CRITICAL, ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW)

${headMarker} ${headSha} -->
${verdictMarker}
<!-- findings-json-start
${JSON.stringify(items, null, 2)}
findings-json-end -->`;
}
```

Note: `manifestFallbackReason` is kept for backward compatibility; `manifestStatus.fallbackReason` takes precedence.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire the status into the "Post review findings" step**

In `opencode-review/action.yml`, in the "Post review findings" step (`625-730`), replace the block that reads `/tmp/manifest-fallback-reason` and calls `buildVerdictComment` (`711-724`) with:

```js
          let serenaStatus = process.env.SERENA_STATUS || 'unavailable';
          let manifestStatus = undefined;
          if (fs.existsSync('/tmp/manifest-status.json')) {
            manifestStatus = JSON.parse(fs.readFileSync('/tmp/manifest-status.json', 'utf8'));
          } else if (fs.existsSync('/tmp/manifest-fallback-reason')) {
            manifestStatus = { fallbackReason: fs.readFileSync('/tmp/manifest-fallback-reason', 'utf8').trim() };
          }

          const verdictBody = buildVerdictComment({
            findings: result.kept,
            headSha,
            verdictMarker: '\${{ inputs.verdict_marker }}',
            headMarker: '\${{ inputs.head_marker }}',
            serenaStatus,
            manifestStatus,
          });
```

- [ ] **Step 6: Build, verify no drift, commit**

Run: `npm run build && npm run check-dist`
Expected: passes.

```bash
git add opencode-review/src/ocr/post-findings.ts opencode-review/src/ocr/post-findings.test.ts opencode-review/dist/ocr/post-findings.js opencode-review/dist/ocr/post-findings.test.js opencode-review/action.yml
git commit -m "feat(review): surface manifest status + missing optional context in verdict"
```

---

## Task 4: Correct the onboarding skill + README accuracy

**Files:**
- Modify: `skills/initialize-review-context/SKILL.md` (`34-42`)
- Modify: `README.md` (`135-146`)

- [ ] **Step 1: Fix the skill's LOCKED/BOUNDED advice**

In `skills/initialize-review-context/SKILL.md`, replace lines `34-42` (the "Testspecs must use…" paragraph through "Report verdict") so the LOCKED/BOUNDED paragraph reads:

```markdown
   Testspecs must use `conditional_context` (blocking when their glob changes), NOT
   `optional_context` — optional context is not enforced by the review engine.

   LOCKED and BOUNDED fields (`excluded_paths`, `diff_override`, `review_directives`,
   `diff_limits`, `docs_only_paths`) MUST be present in the repo manifest, but their
   values are enforced against the toolkit defaults at runtime:
   - `excluded_paths`, `docs_only_paths`, `review_directives` — repo values are UNIONED
     with the toolkit defaults (repo can add, never remove).
   - `diff_override` — must equal the toolkit default exactly.
   - `diff_limits` — repo values must be at or below the toolkit ceiling (100 files / 5000 lines).
   Copy the values from `context/defaults/REVIEW.example.md`; do not omit them.

3. **Create gap stubs.** For any REQUIRED doc that does not exist, create a stub
   file containing the sentinel `ASTRO_REVIEW_CONTEXT_INCOMPLETE` and a note that
   repo-owner input is required. At review time, a required context file containing
   this sentinel blocks the review (status BLOCKED) until it is filled.

4. **Validate.** Ensure the manifest parses against the v4.3 schema validator.
   The review runtime also enforces required-context existence: a missing or
   incomplete required_context (or a conditional_context whose glob changed)
   blocks the review unless `fail_closed_context: "false"` is set in the workflow.

5. **Report verdict.**
   - READY — REVIEW.md exists and required context is complete.
   - READY_WITH_GAPS — REVIEW.md exists; optional context missing (review proceeds).
   - BLOCKED — required context missing/incomplete, or manifest failed validation.
```

- [ ] **Step 2: Fix the README "Tiered defaults" + example sections**

In `README.md`, replace lines `135-146` with:

```markdown
### Tiered defaults (enforced at runtime)

The toolkit ships locked and bounded defaults (`context/defaults/manifest-defaults.json`),
applied by `resolve-manifest` before every review:
- **LOCKED** fields: `excluded_paths` (union), `diff_override` (must equal default),
  `review_directives` (toolkit directives prepended) — repos cannot loosen these.
- **BOUNDED** fields: `diff_limits` (ceiling 100 files / 5000 lines — repo must be ≤),
  `docs_only_paths` (union).

These keys are required in the repo manifest (copy them from `REVIEW.example.md`);
their values are validated against the toolkit defaults on every run. A repo that
exceeds a ceiling or weakens a locked value is blocked (status BLOCKED).

### Required-context enforcement

`resolve-manifest` also classifies context: a missing or incomplete (`ASTRO_REVIEW_CONTEXT_INCOMPLETE`)
required_context file — or a conditional_context doc whose `when_changed` glob matches the
diff — blocks the review (status BLOCKED). Set `fail_closed_context: "false"` in the workflow
to downgrade this to a warning during migration. Optional-context gaps produce a
READY_WITH_GAPS verdict and the review proceeds.

### `REVIEW.example.md`

A copy-pasteable example manifest ships in `context/defaults/REVIEW.example.md` for onboarding
new repos. Run the `initialize-review-context` skill to detect existing docs and generate a
`REVIEW.md` from them.
```

- [ ] **Step 3: Commit**

```bash
git add skills/initialize-review-context/SKILL.md README.md
git commit -m "docs(review): correct onboarding skill + README on enforced defaults and context blocking"
```

---

## Task 5: Consumer repo follow-up (`astronautsid/astro-ads-be`)

**This task is in a different repo** (`astro-ads-be`), performed after the toolkit change ships.

**Files:**
- Modify: `REVIEW.md`
- Modify: `.github/workflows/opencode-pr-ocr.yml`

- [ ] **Step 1: Remove the redundant `review_directives` entry**

The toolkit default already ships the identical DB-layer no-refactor directive. After Task 1 ships, keeping the repo's copy produces a duplicate OCR rule. In `astro-ads-be/REVIEW.md`, remove the `review_directives` array entry (the one with `when_changed: ["internal/**/db/**"]`) so the merged manifest has a single directive inherited from the toolkit. Keep `review_directives: []` is not valid (omit the key only if schema allows; the validator requires the key, so set it to `[]`).

- [ ] **Step 2: Decide `fail_closed_context` until missing docs exist**

The repo's `REVIEW.md` declares `conditional_context` for `tracker` and `insight` whose target docs (`docs/architecture/tracker.md`, `docs/architecture/insight.md`) are listed as Known Gaps and do not exist. Once Task 1 ships, a PR touching `internal/domain/tracker/**` would be BLOCKED. Until those docs (or gap stubs) exist, set in `.github/workflows/opencode-pr-ocr.yml`:

```yaml
        with:
          mentions: /review-ocr
          use_github_token: true
          fail_closed_context: "false"
          ocr_llm_url: ${{ secrets.OCR_POC_LLM_URL }}
          ocr_llm_token: ${{ secrets.OCR_POC_LLM_TOKEN }}
```

Once `tracker.md` / `insight.md` (or `ASTRO_REVIEW_CONTEXT_INCOMPLETE` stubs) are committed, remove `fail_closed_context: "false"` to restore the default fail-closed behavior.

- [ ] **Step 3: Commit (in the consumer repo)**

```bash
git add REVIEW.md .github/workflows/opencode-pr-ocr.yml
git commit -m "chore(review): inherit DB directive from toolkit; set fail_closed_context until tracker/insight docs exist"
```

---

## Verification (run after all tasks)

- [ ] `npm test` — all unit + integration tests pass (including the new `resolveManifest` and `buildVerdictComment` cases).
- [ ] `npm run build && npm run check-dist` — no committed-dist drift.
- [ ] `python3 -c "import yaml; yaml.safe_load(open('opencode-review/action.yml'))"` — action YAML valid.
- [ ] Local dry run of `resolve-manifest.js` against the org-default manifest produces a valid `manifest-status.json`.
- [ ] Manual: on a test PR, trigger `/review-ocr` and confirm (a) the verdict Context block shows `Context status:` and (b) org mandatory rules now appear in `ocr-rule.json` (proving the `ORG_PROFILES_INPUT` export fix worked).

## Rollout risk

- **Gap B flips missing-required from fail-open to fail-closed.** Any repo whose `required_context` or matching `conditional_context` references a non-existent file will start blocking. Mitigation: `fail_closed_context: "false"` (per-repo) until docs are complete. The default remains `"true"` to honour the documented contract.
- **Org profiles now actually load** (latent bug fix). Reviews that previously ran without org mandatory rules will now include them — strictly more enforcement, but expect a small uptick in org-rule findings on the first run after release.

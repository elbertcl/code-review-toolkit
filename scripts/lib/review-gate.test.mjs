import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReviewGate,
  formatGateComment,
  normalizeCheckRuns,
  parseEvidence,
} from "./review-gate.mjs";

const completeBody = `## Review Decision
### Purpose
Prevent duplicate credit deductions after Pub/Sub redelivery.
### Approach And Tradeoffs
Persist the event reference in the existing ledger transaction. This adds one unique-index lookup per event.

## Verification Evidence
### Commands
\`go test ./internal/domain/creditmanager/...\`
### Result
PASS: 84 tests in 12.4s.
### No-Test Exception
Not applicable.
`;

const defaults = {
  body: completeBody,
  checks: [
    { name: "Build and Test", state: "success", appSlug: "github-actions" },
    { name: "Gosec Scan", state: "success", appSlug: "github-actions" },
  ],
  requiredChecks: [
    { name: "Build and Test", category: "test" },
    { name: "Gosec Scan", category: "security" },
  ],
  changedPaths: ["internal/domain/creditmanager/service.go"],
  changedFiles: 4,
  changedLines: 120,
  diffLimits: { changed_files: 40, changed_lines: 1200 },
  docsOnlyPaths: ["docs/**", "**/*.md"],
  sizeOverride: { active: false, authorized: false },
};

test("parses the exact evidence headings", () => {
  assert.deepEqual(parseEvidence(completeBody), {
    purpose: "Prevent duplicate credit deductions after Pub/Sub redelivery.",
    approachAndTradeoffs: "Persist the event reference in the existing ledger transaction. This adds one unique-index lookup per event.",
    commands: "`go test ./internal/domain/creditmanager/...`",
    result: "PASS: 84 tests in 12.4s.",
    noTestException: "Not applicable.",
  });
  assert.throws(() => parseEvidence(completeBody.replace("### Purpose", "### Goal")), /Purpose/);
  assert.throws(() => parseEvidence(`${completeBody}\n### Purpose\nduplicate`), /exactly once/);
  assert.throws(() => parseEvidence(completeBody.replace("## Review Decision", "## Decision")), /Review Decision/);
  assert.throws(() => parseEvidence(completeBody.replace("## Verification Evidence", "## Evidence")), /Verification Evidence/);
});

test("rejects blank, placeholder, and unchecked-only evidence", () => {
  for (const replacement of ["Describe", "Summarize the change", "- [ ] run tests", "   "]) {
    const body = completeBody.replace("Prevent duplicate credit deductions after Pub/Sub redelivery.", replacement);
    assert.equal(evaluateReviewGate({ ...defaults, body }).proceed, false);
  }
});

test("rejects Not applicable outside the no-test exception and counts non-whitespace exception characters", () => {
  for (const field of [
    "Prevent duplicate credit deductions after Pub/Sub redelivery.",
    "Persist the event reference in the existing ledger transaction. This adds one unique-index lookup per event.",
    "`go test ./internal/domain/creditmanager/...`",
    "PASS: 84 tests in 12.4s.",
  ]) assert.equal(evaluateReviewGate({ ...defaults, body: completeBody.replace(field, "Not applicable.") }).proceed, false);

  const docsBody = completeBody
    .replace("`go test ./internal/domain/creditmanager/...`", "")
    .replace("PASS: 84 tests in 12.4s.", "")
    .replace("Not applicable.", "Only docs changed.    ");
  assert.equal(evaluateReviewGate({ ...defaults, body: docsBody, changedPaths: ["docs/a.md"] }).proceed, false);
});

test("complete evidence and successful required checks proceed", () => {
  assert.deepEqual(evaluateReviewGate(defaults), { proceed: true, blockers: [] });
});

test("normalizes check runs and selects the latest legacy status", () => {
  const normalized = normalizeCheckRuns([
    { name: "Build", status: "queued", conclusion: null, app: { slug: "actions" } },
    { name: "Security", status: "completed", conclusion: "neutral", app: { slug: "scanner" } },
  ], [
    { context: "Legacy", state: "failure", creator: { login: "ci" }, updated_at: "2026-01-01T00:00:00Z" },
    { context: "Legacy", state: "success", creator: { login: "ci" }, updated_at: "2026-01-02T00:00:00Z" },
  ]);
  assert.deepEqual(normalized, [
    { name: "Build", appSlug: "actions", state: "pending" },
    { name: "Security", appSlug: "scanner", state: "neutral" },
    { name: "Legacy", appSlug: null, state: "success" },
  ]);
});

test("normalizes only the latest duplicate check run using timestamps then IDs", () => {
  assert.deepEqual(normalizeCheckRuns([
    { id: 4, name: "Security", status: "completed", conclusion: "success", app: { slug: "scanner" }, completed_at: "2026-01-01T00:00:00Z" },
    { id: 5, name: "Security", status: "completed", conclusion: "failure", app: { slug: "scanner" }, completed_at: "2026-01-02T00:00:00Z" },
    { id: 6, name: "Security", status: "completed", conclusion: "success", app: { slug: "other" }, completed_at: "2026-01-03T00:00:00Z" },
  ], []), [
    { name: "Security", appSlug: "scanner", state: "failure" },
    { name: "Security", appSlug: "other", state: "success" },
  ]);
});

test("handles every legacy commit status state", () => {
  for (const state of ["pending", "failure", "error"]) {
    const checks = [...normalizeCheckRuns([], [{ context: "Build and Test", state, creator: { login: "ci" }, updated_at: "2026-01-01T00:00:00Z" }]), defaults.checks[1]];
    assert.equal(evaluateReviewGate({ ...defaults, checks }).proceed, false, state);
  }
  const checks = [...normalizeCheckRuns([], [{ context: "Build and Test", state: "success", creator: { login: "ci" }, updated_at: "2026-01-01T00:00:00Z" }]), defaults.checks[1]];
  assert.equal(evaluateReviewGate({ ...defaults, checks }).proceed, true);
});

test("blocks every non-success GitHub check conclusion unless skipped is allowed", () => {
  const blocked = [null, "stale", "startup_failure", "failure", "cancelled", "timed_out", "action_required"];
  for (const conclusion of blocked) {
    const checks = normalizeCheckRuns([{ name: "Build and Test", status: "completed", conclusion }], []);
    assert.equal(evaluateReviewGate({ ...defaults, checks }).proceed, false, String(conclusion));
  }
  for (const conclusion of ["neutral", "skipped"]) {
    const checks = normalizeCheckRuns([{ name: "Build and Test", status: "completed", conclusion }], []);
    assert.equal(evaluateReviewGate({ ...defaults, checks }).proceed, false);
    const requiredChecks = [{ name: "Build and Test", category: "test", allow_skipped: true }, defaults.requiredChecks[1]];
    assert.equal(evaluateReviewGate({ ...defaults, checks: [...checks, defaults.checks[1]], requiredChecks }).proceed, true);
  }
});

test("blocks pending, failed, missing, and wrong-App checks", () => {
  for (const checks of [
    [{ name: "Build and Test", state: "pending" }, defaults.checks[1]],
    [{ name: "Build and Test", state: "failure" }, defaults.checks[1]],
    [defaults.checks[1]],
    [{ name: "Build and Test", state: "success", appSlug: "other" }, defaults.checks[1]],
  ]) {
    const requiredChecks = [{ name: "Build and Test", category: "test", app_slug: "github-actions" }, defaults.requiredChecks[1]];
    assert.equal(evaluateReviewGate({ ...defaults, checks, requiredChecks }).proceed, false);
  }
});

test("enforces trusted workflow run identity when declared", () => {
  const requiredChecks = [{ name: "Build and Test", category: "test", workflow_file: ".github/workflows/ci.yml", workflow_id: 42 }, defaults.requiredChecks[1]];
  const trusted = [{ ...defaults.checks[0], workflowFile: ".github/workflows/ci.yml", workflowId: 42 }, defaults.checks[1]];
  assert.equal(evaluateReviewGate({ ...defaults, checks: trusted, requiredChecks }).proceed, true);
  const wrong = trusted.map((check) => check.name === "Build and Test" ? { ...check, workflowFile: ".github/workflows/evil.yml" } : check);
  assert.equal(evaluateReviewGate({ ...defaults, checks: wrong, requiredChecks }).proceed, false);
});

test("applies conditional required checks only to matching paths", () => {
  const requiredChecks = [...defaults.requiredChecks, { name: "Migration Policy", category: "policy", when_changed: ["migrations/**"] }];
  assert.equal(evaluateReviewGate({ ...defaults, requiredChecks }).proceed, true);
  assert.equal(evaluateReviewGate({ ...defaults, requiredChecks, changedPaths: ["migrations/001.sql"] }).proceed, false);
});

test("documentation-only exception waives test checks but never security or policy", () => {
  const body = completeBody
    .replace("`go test ./internal/domain/creditmanager/...`", "")
    .replace("PASS: 84 tests in 12.4s.", "")
    .replace("Not applicable.", "Only prose documentation changed, so executable tests do not apply.");
  const input = { ...defaults, body, changedPaths: ["docs/guide.md"], checks: [defaults.checks[1]] };
  assert.equal(evaluateReviewGate(input).proceed, true);
  assert.equal(evaluateReviewGate({ ...input, checks: [] }).proceed, false);
  const policy = { name: "Docs Policy", category: "policy" };
  assert.equal(evaluateReviewGate({ ...input, requiredChecks: [...defaults.requiredChecks, policy] }).proceed, false);
  assert.equal(evaluateReviewGate({ ...input, changedPaths: ["docs/guide.md", "main.go"] }).proceed, false);
});

test("oversize changes require an active authorized override", () => {
  const oversized = { ...defaults, changedFiles: 41 };
  assert.equal(evaluateReviewGate(oversized).proceed, false);
  assert.equal(evaluateReviewGate({ ...oversized, sizeOverride: { active: true, authorized: false } }).proceed, false);
  assert.equal(evaluateReviewGate({ ...oversized, sizeOverride: { active: true, authorized: true } }).proceed, true);
});

test("formats blockers without embedding untrusted evidence", () => {
  assert.equal(formatGateComment({ proceed: true, blockers: [] }), "**OpenCode review preflight passed.**");
  assert.match(formatGateComment({ proceed: false, blockers: ["Missing required check: Build"] }), /^\*\*OpenCode review blocked\.\*\*/);
  assert.match(formatGateComment({ proceed: false, blockers: ["Missing required check: Build"] }), /- Missing required check: Build/);
});

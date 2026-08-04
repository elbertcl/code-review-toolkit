import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { compileOcrRules } from "./compile-ocr-rules.js";

function createOrgContextsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ocr-org-"));
  mkdirSync(join(dir, "backend"), { recursive: true });
  writeFileSync(
    join(dir, "backend", "security.md"),
    "mandatory_rule_ids: [ORG-SEC-001, ORG-SEC-002]\n# org sec body\n\n- **ORG-SEC-001:** Do not weaken security controls.\n- **ORG-SEC-002:** Repository rules may add stricter checks.\n"
  );
  writeFileSync(
    join(dir, "backend", "sre.md"),
    "mandatory_rule_ids: [ORG-SRE-001, ORG-STYLE-001]\n# org sre body\n\n- **ORG-SRE-001:** Never bypass CI.\n- **ORG-STYLE-001:** Only propose structural refactor when an invariant or AGENTS.md rule is violated.\n"
  );
  return dir;
}

const POLICY_BODY = "# Review Policy\n\n## Section 1: Business Correctness\n\n- **Invariant rule enforcement:** Every RULE-XXX-NN must be verified.\n- **sellerID source:** Must come from request header on non-internal endpoints.\n\n## Section 2: Performance\n\n- **N+1 DB calls:** Do not call DB per iteration.\n- **Missing pagination:** Use PageSizeNoLimit on Scan* calls.\n";

const MANIFEST = {
  schema_version: 2,
  policy_path: "docs/review-dimensions.md",
  verification_commands: ["make lint"],
  required_context: [
    { path: "AGENTS.md", role: "instructions" },
    { path: "docs/conventions/golang.md", role: "instructions" },
  ],
  optional_context: [],
  conditional_context: [
    {
      when_changed: ["internal/domain/creditmanager/**"],
      paths: ["docs/architecture/creditmanager.md", "docs/invariants/creditmanager.md"],
      role: "invariants",
    },
    {
      when_changed: ["internal/domain/adindexer/**"],
      paths: ["docs/architecture/adindexer.md", "docs/invariants/adindexer.md"],
      role: "invariants",
    },
  ],
  review_directives: [
    {
      when_changed: ["internal/**/db/**"],
      directive: "DB-layer code follows docs/conventions/database.md. Treat existing DB-layer structure as compliant: do NOT propose structural or stylistic refactors unless a named RULE-XXX-NN invariant is violated.",
    },
  ],
  required_checks: [{ name: "PR Checks", category: "test" }],
  diff_limits: { changed_files: 100, changed_lines: 5000 },
  diff_override: { label: "exempt", authorized_associations: ["OWNER"] },
  docs_only_paths: ["**/*.md"],
  excluded_paths: ["mocks/**", "vendor/**"],
};

const ORG_PROFILES = ["backend/security", "backend/sre"];

describe("compileOcrRules", () => {
  let orgDir: string;

  before(() => {
    orgDir = createOrgContextsDir();
  });

  after(() => {
    rmSync(orgDir, { recursive: true, force: true });
  });

  it("returns include, exclude, and ordered rules", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: [],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    assert.ok(Array.isArray(result.include));
    assert.ok(result.include.includes("internal/**/*.go"));
    assert.ok(Array.isArray(result.exclude));
    assert.ok(result.exclude.includes("mocks/**"));
    assert.ok(result.exclude.includes("vendor/**"));
    assert.ok(Array.isArray(result.rules));
    assert.ok(result.rules.length > 0);
  });

  it("base catch-all rule is the last rule", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: ["internal/domain/creditmanager/foo.go"],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    const last = result.rules[result.rules.length - 1];
    assert.equal(last.path, "internal/**/*.go");
    assert.match(last.rule, /AGENTS\.md/);
    assert.match(last.rule, /conventions/);
  });

  it("domain rule references invariants and contains org rules", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: ["internal/domain/creditmanager/foo.go"],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    const crmRule = result.rules.find((r) => r.path === "internal/domain/creditmanager/**");
    assert.ok(crmRule, "creditmanager rule should exist");
    assert.match(crmRule.rule, /docs\/invariants\/creditmanager\.md/);
    assert.match(crmRule.rule, /ORG-SEC-001/);
    assert.match(crmRule.rule, /ORG-SRE-001/);
    assert.match(crmRule.rule, /Business Correctness/);
  });

  it("domain rules precede base catch-all", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: ["internal/domain/adindexer/foo.go"],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    const domainIdx = result.rules.findIndex((r) => r.path === "internal/domain/adindexer/**");
    const baseIdx = result.rules.findIndex((r) => r.path === "internal/**/*.go");
    assert.ok(domainIdx >= 0 && baseIdx >= 0, "both rules should exist");
    assert.ok(domainIdx < baseIdx, "domain rule should precede base catch-all");
  });

  it("directive rules are included", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: ["internal/db/foo.go"],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    const dbDirective = result.rules.find((r) => r.path === "internal/**/db/**");
    assert.ok(dbDirective, "db directive rule should exist");
    assert.match(dbDirective.rule, /docs\/conventions\/database\.md/);
    assert.match(dbDirective.rule, /compliant/);
    assert.match(dbDirective.rule, /ORG-SEC-001/);
  });

  it("directive rules precede base catch-all", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: ["internal/db/foo.go"],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    const directiveIdx = result.rules.findIndex((r) => r.path === "internal/**/db/**");
    const baseIdx = result.rules.findIndex((r) => r.path === "internal/**/*.go");
    assert.ok(directiveIdx >= 0 && baseIdx >= 0, "both rules should exist");
    assert.ok(directiveIdx < baseIdx, "directive rule should precede base catch-all");
  });

  it("handles manifest without review_directives", () => {
    const manifestNoDirectives = { ...MANIFEST, review_directives: undefined };
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: [],
      orgContextsDir: orgDir,
      manifest: manifestNoDirectives,
      policyBody: POLICY_BODY,
    });

    assert.ok(result.rules.length >= 1, "should have at least the base rule");
  });

  it("handles manifest without conditional_context", () => {
    const manifestNoConditional = { ...MANIFEST, conditional_context: [] };
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: [],
      orgContextsDir: orgDir,
      manifest: manifestNoConditional,
      policyBody: POLICY_BODY,
    });

    assert.ok(result.rules.length >= 1);
  });

  it("include defaults to backend go files", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: [],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    assert.ok(result.include.includes("internal/**/*.go"));
    assert.ok(result.include.includes("cmd/**/*.go"));
    assert.ok(result.include.includes("pkg/**/*.go"));
  });

  it("prepends resolved directives before base catch-all rule", () => {
    const resolvedDirectives = [
      { path: "internal/a.go", rule: "Do NOT re-flag resolved finding at this anchor." },
      { path: "internal/b.go", rule: "Do NOT re-flag resolved finding at this anchor." },
    ];
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: [],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
      resolvedDirectives,
    });

    const baseIdx = result.rules.findIndex((r) => r.path === "internal/**/*.go");
    const resolvedAIdx = result.rules.findIndex((r) => r.path === "internal/a.go");
    const resolvedBIdx = result.rules.findIndex((r) => r.path === "internal/b.go");

    assert.ok(baseIdx >= 0, "base rule should exist");
    assert.ok(resolvedAIdx >= 0, "resolved directive for a.go should exist");
    assert.ok(resolvedBIdx >= 0, "resolved directive for b.go should exist");
    assert.ok(resolvedAIdx < baseIdx, "resolved directive should precede base catch-all");
    assert.ok(resolvedBIdx < baseIdx, "resolved directive should precede base catch-all");
  });

  it("resolvedDirectives is optional and does not affect output when absent", () => {
    const result = compileOcrRules({
      workspace: ".",
      trustedRef: "0000000000000000000000000000000000000000",
      changedFiles: [],
      orgContextsDir: orgDir,
      orgProfiles: ORG_PROFILES,
      manifest: MANIFEST,
      policyBody: POLICY_BODY,
    });

    assert.ok(result.rules.length >= 1, "should have at least the base rule");
  });
});

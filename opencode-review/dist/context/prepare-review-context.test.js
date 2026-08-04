import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildOpenThreadsSection, compileReviewContext } from "./prepare-review-context.js";
const MANIFEST = `<!-- astro-review-manifest:start -->
\`\`\`json
{
  "schema_version": 1,
  "policy_path": "docs-policy.md",
  "verification_commands": ["make lint"],
  "required_context": [{"path": "AGENTS.md", "role": "instructions"}],
  "optional_context": [],
  "conditional_context": [],
  "required_checks": [{"name": "PR Checks", "category": "test"}],
  "diff_limits": {"changed_files": 100, "changed_lines": 5000},
  "diff_override": {"label": "x", "authorized_associations": ["OWNER"]},
  "docs_only_paths": ["**/*.md"],
  "excluded_paths": ["vendor/**"]
}
\`\`\`
<!-- astro-review-manifest:end -->
`;
function initRepo() {
    const dir = mkdtempSync(join(tmpdir(), "ctx-repo-"));
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t.dev");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "REVIEW.md"), MANIFEST);
    writeFileSync(join(dir, "docs-policy.md"), "# policy\n");
    writeFileSync(join(dir, "AGENTS.md"), "# agents\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    return { dir, sha: git("rev-parse", "HEAD").trim() };
}
function initOrgContextsDir() {
    const dir = mkdtempSync(join(tmpdir(), "ctx-org-"));
    mkdirSync(join(dir, "backend"), { recursive: true });
    writeFileSync(join(dir, "backend", "security.md"), "mandatory_rule_ids: [ORG-SEC-001, ORG-SEC-002]\n# org sec body\n");
    writeFileSync(join(dir, "backend", "sre.md"), "mandatory_rule_ids: [ORG-SRE-001]\n# org sre body\n");
    return dir;
}
test("compileReviewContext reads org contexts from the action-checkout filesystem dir", async () => {
    const { dir, sha } = initRepo();
    const orgDir = initOrgContextsDir();
    const outputPath = join(dir, ".opencode/tmp/review_context.md");
    const result = await compileReviewContext({
        workspace: dir,
        trustedRef: sha,
        changedFiles: [],
        orgContextsDir: orgDir,
        outputPath,
        maxBytes: 500000,
        orgProfiles: ["backend/security", "backend/sre"],
    });
    const body = readFileSync(outputPath, "utf8");
    assert.match(body, /# org sec body/);
    assert.match(body, /# org sre body/);
    assert.equal(result.status, "READY");
    rmSync(dir, { recursive: true, force: true });
    rmSync(orgDir, { recursive: true, force: true });
});
test("CLI prints REVIEW_CONTEXT_STATUS and honors --org-contexts-dir", () => {
    const { dir, sha } = initRepo();
    const orgDir = initOrgContextsDir();
    const changed = join(dir, "changed.json");
    writeFileSync(changed, "[]");
    const out = execFileSync("node", [
        join(process.cwd(), "opencode-review/dist/context/prepare-review-context.js"),
        "--workspace", dir,
        "--trusted-ref", sha,
        "--changed-files", changed,
        "--org-contexts-dir", orgDir,
        "--max-bytes", "500000",
        "--org-profiles", "backend/security,backend/sre",
    ], { encoding: "utf8" });
    assert.match(out, /^REVIEW_CONTEXT_STATUS=READY$/m);
    rmSync(dir, { recursive: true, force: true });
    rmSync(orgDir, { recursive: true, force: true });
});
test("buildOpenThreadsSection returns null for empty input", () => {
    assert.equal(buildOpenThreadsSection([]), null);
    assert.equal(buildOpenThreadsSection(null), null);
});
test("buildOpenThreadsSection renders a directive and one line per thread", () => {
    const section = buildOpenThreadsSection([
        { path: "internal/a.go", line: 10, latest_author: "alice", latest_body_excerpt: "please rename" },
    ]);
    assert.equal(section.path, "pr/open-threads");
    assert.match(section.rendered, /Do NOT re-flag/);
    assert.match(section.rendered, /internal\/a\.go:10/);
});
test("compileReviewContext appends open-threads section when provided", async () => {
    const { dir, sha } = initRepo();
    const orgDir = initOrgContextsDir();
    const threadsPath = join(dir, "threads.json");
    writeFileSync(threadsPath, JSON.stringify([
        { path: "internal/a.go", line: 5, latest_author: "alice", latest_body_excerpt: "old note" },
    ]));
    const outputPath = join(dir, ".opencode/tmp/review_context.md");
    const result = await compileReviewContext({
        workspace: dir, trustedRef: sha, changedFiles: [], orgContextsDir: orgDir,
        outputPath, maxBytes: 500000, openThreadsPath: threadsPath,
        orgProfiles: ["backend/security", "backend/sre"],
    });
    assert.ok(result.sources.some((s) => s.path === "pr/open-threads"));
    rmSync(dir, { recursive: true, force: true });
    rmSync(orgDir, { recursive: true, force: true });
});
//# sourceMappingURL=prepare-review-context.test.js.map
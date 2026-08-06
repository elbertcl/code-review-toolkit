import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveManifest } from "./resolve-manifest.js";
function manifestMarkdown(overrides = {}) {
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
function makeFixture(manifestMd, files = {}, changedFiles = []) {
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
    let dirs = [];
    const cleanup = () => { for (const d of dirs)
        rmSync(d, { recursive: true, force: true }); dirs = []; };
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
        assert.ok(r.status.blockers.some((b) => /AGENTS\.md is incomplete/.test(b)));
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
        assert.ok(r.status.blockers.some((b) => /exceeds org ceiling/.test(b)));
    });
    it("merged manifest has LOCKED excluded_paths unioned with defaults", () => {
        const md = manifestMarkdown({ excluded_paths: ["extra/**"] });
        const f = makeFixture(md, { "AGENTS.md": "# agents" });
        dirs.push(f.workspace);
        const r = resolveManifest({ repoManifestPath: f.repoManifest, fallbackManifestPath: f.fallbackManifest, defaultsJsonPath: f.defaultsJson, changedFilesJsonPath: f.changedFilesJson, workspace: f.workspace });
        assert.ok(r.manifest.excluded_paths.includes("mocks/**"));
        assert.ok(r.manifest.excluded_paths.includes("vendor/**"));
        assert.ok(r.manifest.excluded_paths.includes("extra/**"));
    });
});
//# sourceMappingURL=resolve-manifest.test.js.map
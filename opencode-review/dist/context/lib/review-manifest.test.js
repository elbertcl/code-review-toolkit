import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, selectDirectives, mergeWithDefaults, resolveOrgProfiles } from "./review-manifest.js";
const BASE_MANIFEST = {
    schema_version: 1,
    policy_path: "docs/policy.md",
    verification_commands: ["make lint"],
    required_context: [],
    optional_context: [],
    conditional_context: [],
    required_checks: [{ name: "lint", category: "test" }],
    diff_limits: { changed_files: 50, changed_lines: 2000 },
    diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
    docs_only_paths: ["docs/**"],
    excluded_paths: ["mocks/**"],
};
describe("validateManifest schema_version", () => {
    it("validates schema_version 1 manifest", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 1 };
        validateManifest(manifest);
    });
    it("validates schema_version 2 manifest", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 2 };
        validateManifest(manifest);
    });
    it("rejects schema_version 1 with review_directives", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 1,
            review_directives: [{ when_changed: ["src/**/*.go"], directive: "do not refactor" }],
        };
        assert.throws(() => validateManifest(manifest), /review_directives requires schema_version 2/);
    });
    it("accepts schema_version 2 with valid review_directives", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 2,
            review_directives: [
                { when_changed: ["internal/**/db/**"], directive: "do not refactor compliant DB code" },
                { when_changed: ["internal/**/handler/**"], directive: "handlers must not contain business logic" },
            ],
        };
        validateManifest(manifest);
    });
    it("accepts schema_version 2 without review_directives (treats as [])", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 2 };
        validateManifest(manifest);
    });
    describe("review_directives validation", () => {
        it("rejects review_directives that is not an array", () => {
            const manifest = { ...BASE_MANIFEST, schema_version: 2, review_directives: "bad" };
            assert.throws(() => validateManifest(manifest), /review_directives must be an array/);
        });
        it("rejects entry missing when_changed", () => {
            const manifest = {
                ...BASE_MANIFEST,
                schema_version: 2,
                review_directives: [{ directive: "do not refactor" }],
            };
            assert.throws(() => validateManifest(manifest), /review_directives entries require exactly when_changed and directive/);
        });
        it("rejects entry missing directive", () => {
            const manifest = {
                ...BASE_MANIFEST,
                schema_version: 2,
                review_directives: [{ when_changed: ["src/**/*.go"] }],
            };
            assert.throws(() => validateManifest(manifest), /review_directives entries require exactly when_changed and directive/);
        });
        it("rejects empty when_changed", () => {
            const manifest = {
                ...BASE_MANIFEST,
                schema_version: 2,
                review_directives: [{ when_changed: [], directive: "do not refactor" }],
            };
            assert.throws(() => validateManifest(manifest), /review_directives.when_changed must contain non-empty strings/);
        });
        it("rejects when_changed with invalid glob", () => {
            const manifest = {
                ...BASE_MANIFEST,
                schema_version: 2,
                review_directives: [{ when_changed: ["src/**/[test].go"], directive: "do not refactor" }],
            };
            assert.throws(() => validateManifest(manifest), /character classes/);
        });
        it("rejects empty directive", () => {
            const manifest = {
                ...BASE_MANIFEST,
                schema_version: 2,
                review_directives: [{ when_changed: ["src/**/*.go"], directive: "  " }],
            };
            assert.throws(() => validateManifest(manifest), /review_directives.directive must be a non-empty string/);
        });
    });
});
describe("validateManifest engine (schema v3)", () => {
    it("validates schema_version 3 manifest without engine", () => {
        validateManifest({ ...BASE_MANIFEST, schema_version: 3 });
    });
    it("accepts schema_version 3 with a full engine block", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 3,
            engine: {
                ocr_model: "deepseek/deepseek-v4-pro",
                ocr_cost_rates: { "deepseek/deepseek-v4-pro": { input_per_million: 0.14 } },
                serena: true,
                org_profiles_add: ["backend/security"],
            },
        };
        validateManifest(manifest);
    });
    it("rejects engine on schema_version 2", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 2, engine: { ocr_model: "x" } };
        assert.throws(() => validateManifest(manifest), /engine requires schema_version 3/);
    });
    it("rejects unknown engine keys", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 3, engine: { ocr_llm_url: "https://x" } };
        assert.throws(() => validateManifest(manifest), /engine contains unknown key ocr_llm_url/);
    });
    it("rejects empty ocr_model", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 3, engine: { ocr_model: "  " } };
        assert.throws(() => validateManifest(manifest), /engine.ocr_model must be a non-empty string/);
    });
    it("rejects non-object ocr_cost_rates", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 3, engine: { ocr_cost_rates: "cheap" } };
        assert.throws(() => validateManifest(manifest), /engine.ocr_cost_rates must be a non-empty object/);
    });
    it("rejects non-boolean serena", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 3, engine: { serena: "yes" } };
        assert.throws(() => validateManifest(manifest), /engine.serena must be a boolean/);
    });
    it("rejects org_profiles_add outside the allowlist", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 3, engine: { org_profiles_add: ["evil/profile"] } };
        assert.throws(() => validateManifest(manifest), /outside the allowlist/);
    });
    it("rejects empty org_profiles_add array", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 3, engine: { org_profiles_add: [] } };
        assert.throws(() => validateManifest(manifest), /org_profiles_add must be a non-empty array/);
    });
});
describe("resolveOrgProfiles", () => {
    const DEFAULTS = {
        locked: { org_profiles_baseline: ["backend/security"] },
        bounded: {},
    };
    it("unions baseline, workflow input, and repo additions (deduped)", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 3,
            engine: { org_profiles_add: ["backend/sre", "backend/security"] },
        };
        const profiles = resolveOrgProfiles(manifest, DEFAULTS, "backend/sre, frontend/security");
        assert.deepStrictEqual(profiles, ["backend/security", "backend/sre", "frontend/security"]);
    });
    it("returns workflow input alone when no baseline or engine additions", () => {
        const manifest = { ...BASE_MANIFEST };
        const profiles = resolveOrgProfiles(manifest, null, "backend/security, backend/sre");
        assert.deepStrictEqual(profiles, ["backend/security", "backend/sre"]);
    });
    it("preserves baseline even when workflow input is empty", () => {
        const manifest = { ...BASE_MANIFEST };
        const profiles = resolveOrgProfiles(manifest, DEFAULTS, "");
        assert.deepStrictEqual(profiles, ["backend/security"]);
    });
});
describe("selectDirectives", () => {
    it("returns [] when manifest has no review_directives", () => {
        const manifest = { ...BASE_MANIFEST, schema_version: 2 };
        const result = selectDirectives(manifest, ["internal/db/foo.go"]);
        assert.deepStrictEqual(result, []);
    });
    it("returns matching directives by changed files", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 2,
            review_directives: [
                { when_changed: ["internal/**/db/**"], directive: "do not refactor DB" },
                { when_changed: ["internal/**/handler/**"], directive: "no business logic in handlers" },
            ],
        };
        const result = selectDirectives(manifest, ["internal/db/query.go"]);
        assert.deepStrictEqual(result, [
            { when_changed: ["internal/**/db/**"], directive: "do not refactor DB" },
        ]);
    });
    it("returns multiple matches, order preserved", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 2,
            review_directives: [
                { when_changed: ["internal/**/db/**"], directive: "first" },
                { when_changed: ["internal/**/db/**", "pkg/**"], directive: "second" },
            ],
        };
        const result = selectDirectives(manifest, ["internal/db/query.go"]);
        assert.deepStrictEqual(result, [
            { when_changed: ["internal/**/db/**"], directive: "first" },
            { when_changed: ["internal/**/db/**", "pkg/**"], directive: "second" },
        ]);
    });
    it("returns [] when no glob matches", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 2,
            review_directives: [
                { when_changed: ["internal/**/db/**"], directive: "do not refactor DB" },
            ],
        };
        const result = selectDirectives(manifest, ["README.md"]);
        assert.deepStrictEqual(result, []);
    });
});
describe("mergeWithDefaults", () => {
    const DEFAULTS = {
        locked: {
            excluded_paths: ["mocks/**", "vendor/**"],
            diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
            review_directives: [
                { when_changed: ["internal/**/db/**"], directive: "do not refactor DB" },
            ],
        },
        bounded: {
            diff_limits: { changed_files: 100, changed_lines: 5000 },
            docs_only_paths: ["**/*.md", "docs/**"],
        },
    };
    it("LOCKED excluded_paths: union, repo cannot remove defaults", () => {
        const manifest = { ...BASE_MANIFEST, excluded_paths: ["extra/**"] };
        const merged = mergeWithDefaults(manifest, DEFAULTS);
        assert.ok(merged.excluded_paths.includes("mocks/**"));
        assert.ok(merged.excluded_paths.includes("vendor/**"));
        assert.ok(merged.excluded_paths.includes("extra/**"));
    });
    it("LOCKED diff_override: equal value allowed, conflicting rejects", () => {
        const manifest = {
            ...BASE_MANIFEST,
            diff_override: { label: "ai-review-size-approved", authorized_associations: ["OWNER", "MEMBER"] },
        };
        const merged = mergeWithDefaults(manifest, DEFAULTS);
        assert.deepStrictEqual(merged.diff_override, DEFAULTS.locked.diff_override);
    });
    it("LOCKED diff_override: conflicting value rejects", () => {
        const manifest = {
            ...BASE_MANIFEST,
            diff_override: { label: "custom", authorized_associations: ["OWNER"] },
        };
        assert.throws(() => mergeWithDefaults(manifest, DEFAULTS), /diff_override is LOCKED/);
    });
    it("LOCKED review_directives: union, repo additions preserved", () => {
        const manifest = {
            ...BASE_MANIFEST,
            schema_version: 2,
            review_directives: [
                { when_changed: ["src/**/*.ts"], directive: "prefer arrow functions" },
            ],
        };
        const merged = mergeWithDefaults(manifest, DEFAULTS);
        assert.ok(merged.review_directives.length >= 2);
        assert.ok(merged.review_directives.some(d => d.when_changed[0] === "internal/**/db/**"));
        assert.ok(merged.review_directives.some(d => d.when_changed[0] === "src/**/*.ts"));
    });
    it("BOUNDED diff_limits: repo within ceiling accepted", () => {
        const manifest = {
            ...BASE_MANIFEST,
            diff_limits: { changed_files: 50, changed_lines: 2000 },
        };
        const merged = mergeWithDefaults(manifest, DEFAULTS);
        assert.equal(merged.diff_limits.changed_files, 50);
        assert.equal(merged.diff_limits.changed_lines, 2000);
    });
    it("BOUNDED diff_limits: repo exceeding ceiling rejects", () => {
        const manifest = {
            ...BASE_MANIFEST,
            diff_limits: { changed_files: 200, changed_lines: 5000 },
        };
        assert.throws(() => mergeWithDefaults(manifest, DEFAULTS), /exceeds org ceiling/);
    });
    it("BOUNDED diff_limits: absent inherits default", () => {
        const { diff_limits, ...withoutDL } = BASE_MANIFEST;
        const merged = mergeWithDefaults(withoutDL, DEFAULTS);
        assert.equal(merged.diff_limits.changed_files, 100);
        assert.equal(merged.diff_limits.changed_lines, 5000);
    });
    it("BOUNDED docs_only_paths: union", () => {
        const manifest = { ...BASE_MANIFEST, docs_only_paths: ["custom/**"] };
        const merged = mergeWithDefaults(manifest, DEFAULTS);
        assert.ok(merged.docs_only_paths.includes("**/*.md"));
        assert.ok(merged.docs_only_paths.includes("custom/**"));
    });
    it("LOCKED/BOUNDED fields optional in repo manifest", () => {
        const merged = mergeWithDefaults(BASE_MANIFEST, DEFAULTS);
        assert.ok(merged.excluded_paths.includes("mocks/**"));
        assert.ok(merged.diff_override.label === "ai-review-size-approved");
    });
});
//# sourceMappingURL=review-manifest.test.js.map
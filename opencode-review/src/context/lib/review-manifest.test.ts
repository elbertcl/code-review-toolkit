import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, selectDirectives } from "./review-manifest.js";

const BASE_MANIFEST = {
  schema_version: 1,
  policy_path: "docs/policy.md",
  verification_commands: ["make lint"],
  required_context: [],
  optional_context: [],
  conditional_context: [],
  required_checks: [{ name: "lint", category: "test" }],
  diff_limits: { changed_files: 500, changed_lines: 5000 },
  diff_override: { label: "exempt", authorized_associations: ["OWNER"] },
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

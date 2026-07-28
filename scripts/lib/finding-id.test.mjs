import assert from "node:assert/strict";
import test from "node:test";

import { findingId } from "./finding-id.mjs";

const finding = {
  repository: "o/r",
  path: "service.go",
  symbol: "Service.Update",
  title: "Missing transaction guard",
  body: "Mutation escapes the transaction. Move both writes together.",
};

test("finding ID survives line movement, force-push metadata, and case-only title changes", () => {
  const changed = { ...finding, line: 400, commit_sha: "a".repeat(40), severity: "LOW", title: "missing transaction guard" };
  assert.equal(findingId(finding), findingId(changed));
  assert.match(findingId(finding), /^arf_[0-9a-f]{20}$/);
});

test("finding ID uses the old path for a verified rename", () => {
  const renamed = {
    ...finding,
    path: "new/service.go",
    rename: { previous_path: "service.go", content_fingerprint_equal: true },
  };
  assert.equal(findingId(finding), findingId(renamed));
  assert.notEqual(findingId(finding), findingId({ ...renamed, rename: { ...renamed.rename, content_fingerprint_equal: false } }));
});

test("deletion metadata and suggested fixes do not alter identity", () => {
  assert.equal(findingId(finding), findingId({ ...finding, deleted: true, suggested_fix: "Different fix" }));
});

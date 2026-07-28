import assert from "node:assert/strict";
import test from "node:test";

import { addSerenaStatus } from "./serena-status.mjs";

test("adds validated Serena status to an experimental analysis artifact", () => {
  const artifact = { schema_version: 1, findings: [] };
  const status = { schema_version: 1, status: "available", revision: "a".repeat(40), reason: "pinned_wrapper_ready" };

  assert.deepEqual(addSerenaStatus(artifact, status), { ...artifact, serena: status });
  assert.equal("serena" in artifact, false);
});

test("rejects unknown statuses, non-commit revisions, and existing fields", () => {
  const base = { schema_version: 1, findings: [] };
  const status = { schema_version: 1, status: "available", revision: "a".repeat(40), reason: "ready" };
  assert.throws(() => addSerenaStatus(base, { ...status, status: "failed" }), /status/);
  assert.throws(() => addSerenaStatus(base, { ...status, revision: "main" }), /revision/);
  assert.throws(() => addSerenaStatus({ ...base, serena: {} }, status), /already/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { classifyOutcome } from "./outcome-classifier.mjs";

const findingId = "arf_12345678901234567890";

test("classifies a resolved thread as accepted", () => {
  assert.equal(classifyOutcome({ findingId, isResolved: true, comments: [] }), "accepted");
});

test("uses the latest valid explicit outcome marker", () => {
  const comments = [
    { body: `<!-- astro-ai-outcome:{"schema_version":1,"finding_id":"${findingId}","outcome":"deferred"} -->`, created_at: "2026-01-01" },
    { body: `<!-- astro-ai-outcome:{"schema_version":1,"finding_id":"${findingId}","outcome":"disputed"} -->`, created_at: "2026-01-02" },
  ];
  assert.equal(classifyOutcome({ findingId, isResolved: false, comments }), "disputed");
});

test("ignores malformed, mismatched, and unknown outcome markers", () => {
  const comments = [
    { body: "source and full comment text must not affect classification" },
    { body: `<!-- astro-ai-outcome:{"schema_version":1,"finding_id":"arf_00000000000000000000","outcome":"accepted"} -->` },
    { body: `<!-- astro-ai-outcome:{"schema_version":1,"finding_id":"${findingId}","outcome":"ignored"} -->` },
  ];
  assert.equal(classifyOutcome({ findingId, isResolved: false, comments }), "unclassified");
});

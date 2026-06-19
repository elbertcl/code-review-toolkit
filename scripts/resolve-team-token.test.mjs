import assert from "node:assert/strict";
import test from "node:test";

import { parseMap, selectDirectToken } from "./resolve-team-token.mjs";

test("selectDirectToken returns configured direct OpenCode API key", () => {
  assert.equal(selectDirectToken("opencode-secret"), "opencode-secret");
});

test("selectDirectToken ignores blank direct OpenCode API key", () => {
  assert.equal(selectDirectToken("   "), "");
});

test("parseMap allows an empty team token map", () => {
  assert.deepEqual(parseMap(""), []);
});

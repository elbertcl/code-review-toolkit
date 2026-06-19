import assert from "node:assert/strict";
import test from "node:test";

import { parseMap, selectDirectToken, selectFirstTeamToken } from "./resolve-team-token.mjs";

test("selectDirectToken returns configured direct OpenCode API key", () => {
  assert.equal(selectDirectToken("opencode-secret"), "opencode-secret");
});

test("selectDirectToken ignores blank direct OpenCode API key", () => {
  assert.equal(selectDirectToken("   "), "");
});

test("parseMap allows an empty team token map", () => {
  assert.deepEqual(parseMap(""), []);
});

test("selectFirstTeamToken returns the first configured team token", () => {
  assert.deepEqual(
    selectFirstTeamToken([
      { team: "ads", apiKey: "ads-token" },
      { team: "platform", apiKey: "platform-token" },
    ]),
    { team: "ads", apiKey: "ads-token" }
  );
});

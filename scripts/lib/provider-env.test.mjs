import assert from "node:assert/strict";
import test from "node:test";

import { resolveProviderEnv } from "./provider-env.mjs";

test("resolves known provider keys and validates explicit overrides", () => {
  assert.equal(resolveProviderEnv("openrouter/deepseek/model"), "OPENROUTER_API_KEY");
  assert.equal(resolveProviderEnv("anthropic/claude", "CUSTOM_PROVIDER_KEY"), "CUSTOM_PROVIDER_KEY");
  assert.throws(() => resolveProviderEnv("unknown/model"), /api_key_env/);
  assert.throws(() => resolveProviderEnv("openai/model", "bad-name"), /api_key_env/);
});

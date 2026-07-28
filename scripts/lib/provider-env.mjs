const PROVIDER_KEYS = Object.freeze({
  "opencode-go": "OPENCODE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
});

export function resolveProviderEnv(model, override = "") {
  if (override) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(override)) throw new Error("api_key_env must be an uppercase environment variable name");
    return override;
  }
  const provider = String(model ?? "").split("/", 1)[0];
  const name = PROVIDER_KEYS[provider];
  if (!name) throw new Error(`No api_key_env mapping for provider ${provider || "(missing)"}`);
  return name;
}

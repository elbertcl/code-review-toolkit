import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runReviewAnalysis, validateFindings } from "./run-review-analysis.mjs";

const sha = "a".repeat(40);
const valid = {
  schema_version: 1, reviewed_head: sha, mode: "review", prior_thread_classifications: [],
  findings: [{ dimension: "security", severity: "HIGH", path: "main.go", line: 2, side: "RIGHT", symbol: "main", title: "Unsafe input", body: "Untrusted input reaches the sink.", suggested_fix: "Validate it first." }],
};

test("validates exact schema, dimensions, anchors, controls, and prior classifications", () => {
  const options = { reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"], addressableLines: { "main.go": { RIGHT: [2], LEFT: [1] } }, priorFindings: [], knownThreadIds: [] };
  assert.deepEqual(validateFindings(valid, options), valid);
  assert.throws(() => validateFindings({ ...valid, command: "gh api" }, options), /unexpected key/);
  assert.throws(() => validateFindings({ ...valid, findings: [{ ...valid.findings[0], body: "bad\u0000" }] }, options), /control character/);
  assert.throws(() => validateFindings({ ...valid, findings: [{ ...valid.findings[0], line: 1 }] }, options), /addressable/);
});

test("extracts exactly one sentinel block and runs command without GITHUB_TOKEN", async () => {
  const workspace = await fixtureWorkspace();
  let commandInput;
  await runReviewAnalysis({
    workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"),
    reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"],
    addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [], knownThreadIds: [],
    executable: "/trusted/bin/opencode", providerKeyEnv: "OPENROUTER_API_KEY",
    env: { PATH: "/usr/bin", HOME: "/hostile", TMPDIR: "/tmp", GITHUB_TOKEN: "must-not-leak", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc", OPENROUTER_API_KEY: "provider", UNRELATED_SECRET: "no" },
    runCommand: async (input) => {
      commandInput = input;
      return `noise\nASTRO_FINDINGS_JSON_START\n${JSON.stringify(valid)}\nASTRO_FINDINGS_JSON_END\n`;
    },
  });
  assert.equal(commandInput.env.GITHUB_TOKEN, undefined);
  assert.equal(commandInput.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(commandInput.env.UNRELATED_SECRET, undefined);
  assert.equal(commandInput.env.OPENROUTER_API_KEY, "provider");
  assert.notEqual(commandInput.env.HOME, "/hostile");
  assert.equal(commandInput.executable, "/trusted/bin/opencode");
  assert.match(commandInput.prompt, /schema_version/);
  assert.match(commandInput.prompt, /review\.diff/);
  assert.equal(commandInput.permissions.edit, "deny");
  assert.equal(commandInput.args.includes("--pure"), true);
  assert.equal(commandInput.args.includes("--agent"), false);
  assert.equal(commandInput.args.includes("--variant"), false);
  assert.equal(await readFile(path.join(commandInput.analysisDirectory, "source/main.go"), "utf8"), "package main\nfunc main() {}\n");
  assert.deepEqual(JSON.parse(await readFile(path.join(workspace, "findings.json"))), valid);
});

test("passes a requested supported variant and never copies repository OpenCode discovery files", async () => {
  const workspace = await fixtureWorkspace();
  await writeFile(path.join(workspace, "opencode.json"), JSON.stringify({ plugin: ["malicious-plugin"] }));
  await mkdir(path.join(workspace, ".opencode/plugins"), { recursive: true });
  await writeFile(path.join(workspace, ".opencode/plugins/evil.js"), "throw new Error('loaded')");
  let commandInput;
  await runReviewAnalysis({
    workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"),
    reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"],
    addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [], knownThreadIds: [],
    executable: "/trusted/bin/opencode", model: "openrouter/model", variant: "max", variantSupported: true,
    providerKeyEnv: "OPENROUTER_API_KEY", env: { OPENROUTER_API_KEY: "provider", PATH: "/usr/bin" },
    runCommand: async (input) => { commandInput = input; return `ASTRO_FINDINGS_JSON_START\n${JSON.stringify(valid)}\nASTRO_FINDINGS_JSON_END`; },
  });
  assert.deepEqual(commandInput.args.slice(0, 2), ["run", "--pure"]);
  assert.equal(commandInput.args.includes("--variant"), true);
  await assert.rejects(readFile(path.join(commandInput.analysisDirectory, "opencode.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(commandInput.analysisDirectory, ".opencode/plugins/evil.js")), /ENOENT/);
});

test("merges only a validated trusted local Serena MCP into isolated config", async () => {
  const workspace = await fixtureWorkspace();
  const launcher = path.join(workspace, "serena-launcher");
  await writeFile(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  let commandInput;
  await runReviewAnalysis({
    workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"),
    reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"],
    addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [], knownThreadIds: [],
    executable: "/trusted/bin/opencode", providerKeyEnv: "OPENROUTER_API_KEY",
    env: { OPENROUTER_API_KEY: "provider", PATH: "/usr/bin" },
    mcp: { serena: { type: "local", command: [launcher, workspace], enabled: true } },
    mcpTrustedRoot: workspace,
    runCommand: async (input) => { commandInput = input; return `ASTRO_FINDINGS_JSON_START\n${JSON.stringify(valid)}\nASTRO_FINDINGS_JSON_END`; },
  });
  const config = JSON.parse(await readFile(path.join(commandInput.env.XDG_CONFIG_HOME, "opencode.json")));
  assert.deepEqual(config.mcp.serena.command, [launcher, workspace]);
  assert.deepEqual(config.permission, { edit: "deny", bash: "deny", webfetch: "deny", external_directory: "deny" });
  assert.equal(config.mcp.serena.environment, undefined);
});

test("rejects untrusted MCP configuration", async () => {
  const workspace = await fixtureWorkspace();
  const common = { workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"), reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"], addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [], knownThreadIds: [], executable: "/trusted/bin/opencode", providerKeyEnv: "OPENROUTER_API_KEY", env: { OPENROUTER_API_KEY: "provider", PATH: "/usr/bin" }, runCommand: async () => `ASTRO_FINDINGS_JSON_START\n${JSON.stringify(valid)}\nASTRO_FINDINGS_JSON_END` };
  await assert.rejects(() => runReviewAnalysis({ ...common, mcpTrustedRoot: workspace, mcp: { evil: { type: "remote", url: "https://example.test" } } }), /MCP configuration/);
  await assert.rejects(() => runReviewAnalysis({ ...common, mcpTrustedRoot: workspace, mcp: { serena: { type: "local", command: ["relative-command"], enabled: true } } }), /MCP configuration/);
});

test("kills analysis on timeout or capped output", async () => {
  const workspace = await fixtureWorkspace();
  const common = { workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"), reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"], addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [], knownThreadIds: [], executable: process.execPath, model: "provider/model", providerKeyEnv: "OPENCODE_API_KEY", env: { OPENCODE_API_KEY: "key", PATH: "/usr/bin" } };
  await assert.rejects(() => runReviewAnalysis({ ...common, commandArgs: ["-e", "setTimeout(()=>{}, 10000)"], timeoutMs: 20 }), /timed out/);
  await assert.rejects(() => runReviewAnalysis({ ...common, commandArgs: ["-e", "process.stdout.write('x'.repeat(10000))"], maxOutputBytes: 100 }), /output limit/);
});

test("rejects duplicate/malformed blocks and symlinks escaping approved roots", async () => {
  const workspace = await fixtureWorkspace();
  const block = `ASTRO_FINDINGS_JSON_START\n${JSON.stringify(valid)}\nASTRO_FINDINGS_JSON_END`;
  const common = { workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"), reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["main.go"], addressableLines: { "main.go": { RIGHT: [2] } }, priorFindings: [], knownThreadIds: [], executable: "/trusted/bin/opencode", providerKeyEnv: "OPENCODE_API_KEY", env: { OPENCODE_API_KEY: "key", PATH: "/usr/bin" } };
  await assert.rejects(() => runReviewAnalysis({ ...common, runCommand: async () => `${block}\n${block}` }), /exactly one/);
  await rm(path.join(workspace, "main.go"));
  await symlink(process.env.HOME, path.join(workspace, "main.go"));
  await assert.rejects(() => runReviewAnalysis({ ...common, runCommand: async () => block }), /symlink escapes/);
});

test("permits deleted changed paths only when their LEFT anchors came from the trusted diff", async () => {
  const workspace = await fixtureWorkspace();
  const deleted = { ...valid, findings: [{ ...valid.findings[0], path: "deleted.go", line: 3, side: "LEFT" }] };
  await runReviewAnalysis({
    workspace, inputDirectory: path.join(workspace, "input"), outputPath: path.join(workspace, "findings.json"),
    reviewedHead: sha, mode: "review", dimensions: ["security"], changedPaths: ["deleted.go"],
    addressableLines: { "deleted.go": { LEFT: [3], RIGHT: [] } }, priorFindings: [], knownThreadIds: [],
    executable: "/trusted/bin/opencode", providerKeyEnv: "OPENCODE_API_KEY", env: { OPENCODE_API_KEY: "key", PATH: "/usr/bin" },
    runCommand: async () => `ASTRO_FINDINGS_JSON_START\n${JSON.stringify(deleted)}\nASTRO_FINDINGS_JSON_END`,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(workspace, "findings.json"))), deleted);
});

async function fixtureWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "analysis-"));
  await mkdir(path.join(workspace, "input"));
  await writeFile(path.join(workspace, "main.go"), "package main\nfunc main() {}\n");
  await writeFile(path.join(workspace, "input", "review.diff"), "+code\n");
  return workspace;
}

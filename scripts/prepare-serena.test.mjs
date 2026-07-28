import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareSerena } from "./prepare-serena.mjs";

const revision = "a".repeat(40);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "prepare-serena-"));
  const analysisInput = path.join(root, "analysis.json");
  await writeFile(analysisInput, JSON.stringify({ workspace: path.join(root, "workspace") }));
  return { root, analysisInput, serenaHome: path.join(root, "serena"), statusPath: path.join(root, "status.json") };
}

test("disabled is emitted only when explicitly false", async () => {
  const options = await fixture();
  const status = await prepareSerena({ ...options, enabled: false });
  assert.equal(status.status, "disabled");
});

test("enabled available setup adds trusted local MCP", async () => {
  const options = await fixture();
  const status = await prepareSerena({ ...options, enabled: true, revision, readinessReport: readyReport(), runSetup: async () => ({ status: "available", reason: "pinned_wrapper_ready" }), runHealthProbe: async () => ({ status: "available", reason: "mcp_tools_ready" }) });
  assert.equal(status.status, "available");
  const analysis = JSON.parse(await readFile(options.analysisInput));
  assert.equal(analysis.mcp.serena.type, "local");
  assert.equal(analysis.mcpTrustedRoot, options.serenaHome);
});

test("enabled setup failure and timeout fail open without MCP", async () => {
  for (const result of [{ status: "unavailable", reason: "setup_failed" }, { status: "timed_out", reason: "setup_timed_out" }]) {
    const options = await fixture();
    const status = await prepareSerena({ ...options, enabled: true, revision, readinessReport: readyReport(), runSetup: async () => result });
    assert.equal(status.status, result.status);
    assert.match(status.warning, /continued without Serena/);
    assert.equal(JSON.parse(await readFile(options.analysisInput)).mcp, undefined);
  }
});

test("enabled setup requires an exact commit SHA", async () => {
  const options = await fixture();
  await assert.rejects(() => prepareSerena({ ...options, enabled: true, revision: "a".repeat(39) }), /exact 40-character/);
});

test("enabled Serena fails closed unless readiness is approved for the exact revision", async () => {
  const options = await fixture();
  await assert.rejects(() => prepareSerena({ ...options, enabled: true, revision, readinessReport: "Status: `NOT_EVALUATED`" }), /not approved/);
  await assert.rejects(() => prepareSerena({ ...options, enabled: true, revision, readinessReport: readyReport("b".repeat(40)) }), /revision does not match/);
});

test("wrapper readiness requires MCP initialize and tools list and fails open", async () => {
  for (const probe of [{ status: "unavailable", reason: "mcp_probe_failed" }, { status: "timed_out", reason: "mcp_probe_timed_out" }]) {
    const options = await fixture();
    const status = await prepareSerena({ ...options, enabled: true, revision, readinessReport: readyReport(), runSetup: async () => ({ status: "available", reason: "pinned_wrapper_ready" }), runHealthProbe: async () => probe });
    assert.equal(status.status, probe.status);
    assert.equal(JSON.parse(await readFile(options.analysisInput)).mcp, undefined);
  }
});

function readyReport(sha = revision) { return `Status: \`READY_FOR_ADS_POC\`\n\n- Serena revision: \`${sha}\``; }

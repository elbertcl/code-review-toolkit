import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runBenchmark } from "./benchmark-client.mjs";

test("benchmarks a bounded MCP initialize, tool listing, and fixed symbol corpus", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "serena-mcp-"));
  const corpusPath = path.join(directory, "corpus.json");
  await writeFile(corpusPath, JSON.stringify([
    { fixture: "symbol", tool: "find_symbol", arguments: { name_path_pattern: "collectMetrics" }, expected: "collectMetrics" },
    { fixture: "references", tool: "find_referencing_symbols", arguments: { name_path: "collectMetrics" }, expected: "collectMetrics.test" },
  ]));

  const samples = await runBenchmark({
    command: [process.execPath, new URL("./fixtures/fake-mcp-server.mjs", import.meta.url).pathname],
    corpusPath,
    timeoutMs: 2_000,
    diskPath: directory,
    pairedInputs: { baseline_ms: 100, baseline_tokens: 120, serena_tokens: 40, baseline_cost_usd: 0.12, serena_cost_usd: 0.04 },
  });

  assert.equal(samples.length, 2);
  assert.ok(samples.every((sample) => sample.status === "available" && sample.compatible));
  assert.ok(samples.every((sample) => sample.cold_setup_ms >= 0 && sample.warm_setup_ms >= 0));
  assert.ok(samples.every((sample) => sample.review_latency_ms >= 0));
  assert.ok(samples.every((sample) => Number.isInteger(sample.rss_bytes) && sample.rss_bytes > 0));
  assert.ok(samples.every((sample) => Number.isInteger(sample.disk_bytes) && sample.disk_bytes >= 0));
  assert.equal(samples[0].baseline_tokens, 120);
  assert.equal(samples[0].serena_cost_usd, 0.04);
  assert.equal(samples[0].serena_ms, samples[0].review_latency_ms);
});

test("fails open when the MCP process exceeds its bound", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "serena-mcp-timeout-"));
  const corpusPath = path.join(directory, "corpus.json");
  await writeFile(corpusPath, JSON.stringify([{ fixture: "symbol", tool: "find_symbol", arguments: {}, expected: "x" }]));
  const samples = await runBenchmark({
    command: [process.execPath, new URL("./fixtures/fake-mcp-server.mjs", import.meta.url).pathname, "--hang"],
    corpusPath,
    timeoutMs: 30,
    diskPath: directory,
    pairedInputs: {},
  });
  assert.equal(samples[0].status, "timed_out");
  assert.equal(samples[0].compatible, false);
});

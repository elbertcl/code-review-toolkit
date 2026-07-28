import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { summarizeBenchmark } from "./summarize.mjs";

const available = (fixture, baselineMs, serenaMs) => ({
  fixture,
  status: "available",
  baseline_ms: baselineMs,
  serena_ms: serenaMs,
  compatible: true,
});

test("reports ready only when every fixed threshold passes", () => {
  const samples = Array.from({ length: 20 }, (_, index) =>
    available(`frontend-${index}`, 100, index === 19 ? 190 : 120),
  );

  const summary = summarizeBenchmark(samples);

  assert.equal(summary.schema_version, 1);
  assert.equal(summary.measurements.sample_count, 20);
  assert.equal(summary.measurements.availability_rate, 1);
  assert.equal(summary.measurements.compatibility_rate, 1);
  assert.equal(summary.measurements.p95_latency_ratio, 1.2);
  assert.equal(summary.readiness.status, "READY");
  assert.deepEqual(summary.readiness.failed_thresholds, []);
});

test("fails readiness for insufficient, unavailable, incompatible, or slow samples", () => {
  const samples = [
    ...Array.from({ length: 16 }, (_, index) => available(`frontend-${index}`, 100, 250)),
    { fixture: "frontend-16", status: "unavailable", compatible: false },
    { fixture: "frontend-17", status: "timed_out", compatible: false },
    { fixture: "frontend-18", status: "disabled", compatible: false },
  ];

  const summary = summarizeBenchmark(samples);

  assert.equal(summary.readiness.status, "NOT_READY");
  assert.deepEqual(summary.readiness.failed_thresholds, [
    "minimum_samples",
    "availability_rate",
    "compatibility_rate",
    "p95_latency_ratio",
  ]);
});

test("rejects unknown statuses and malformed timing data", () => {
  assert.throws(() => summarizeBenchmark([{ fixture: "x", status: "failed" }]), /status/);
  assert.throws(
    () => summarizeBenchmark([{ ...available("x", 0, 1) }]),
    /baseline_ms/,
  );
});

test("CLI writes deterministic JSON from JSONL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "serena-summary-"));
  const input = path.join(directory, "samples.jsonl");
  const output = path.join(directory, "summary.json");
  await writeFile(input, `${JSON.stringify(available("frontend", 100, 120))}\n`);

  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [new URL("./summarize.mjs", import.meta.url).pathname, input, output], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(await readFile(output, "utf8"));
  assert.equal(summary.measurements.sample_count, 1);
  assert.equal(summary.readiness.status, "NOT_READY");
});

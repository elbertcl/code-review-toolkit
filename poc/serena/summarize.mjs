import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const THRESHOLDS = Object.freeze({
  minimum_samples: 20,
  availability_rate: 0.95,
  compatibility_rate: 0.95,
  p95_latency_ratio: 2,
});

const STATUSES = new Set(["available", "unavailable", "timed_out", "disabled"]);

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function summarizeBenchmark(samples) {
  const ratios = [];
  for (const sample of samples) {
    if (!sample || typeof sample.fixture !== "string" || !STATUSES.has(sample.status)) {
      throw new Error("sample fixture or status is invalid");
    }
    if (sample.status === "available") {
      if (!(sample.baseline_ms > 0) || !(sample.serena_ms >= 0)) throw new Error("sample baseline_ms or serena_ms is invalid");
      ratios.push(sample.serena_ms / sample.baseline_ms);
    }
  }
  const count = samples.length;
  const available = samples.filter((sample) => sample.status === "available").length;
  const compatible = samples.filter((sample) => sample.compatible === true).length;
  const measurements = {
    sample_count: count,
    availability_rate: count ? available / count : 0,
    compatibility_rate: count ? compatible / count : 0,
    p95_latency_ratio: percentile(ratios, 0.95),
  };
  const failed = Object.entries(THRESHOLDS).filter(([name, threshold]) => {
    const value = name === "minimum_samples" ? measurements.sample_count : measurements[name];
    return name === "p95_latency_ratio" ? value === null || value > threshold : value < threshold;
  }).map(([name]) => name);
  return {
    schema_version: 1,
    thresholds: THRESHOLDS,
    measurements,
    status_counts: Object.fromEntries([...STATUSES].map((status) => [status, samples.filter((sample) => sample.status === status).length])),
    readiness: { status: failed.length ? "NOT_READY" : "READY", failed_thresholds: failed },
  };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("usage: node summarize.mjs <samples.jsonl> <summary.json>");
  const lines = (await readFile(inputPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const summary = summarizeBenchmark(lines.map((line) => JSON.parse(line)));
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

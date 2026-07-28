import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUTCOMES = ["accepted", "disputed", "deferred", "unclassified"];
const APPROVED_FIELDS = ["repository", "pr_number", "finding_id", "thread_id", "dimension", "severity", "outcome", "finding_created_at", "pr_merged_at", "toolkit_sha", "provider", "model", "confidence", "review_latency_ms", "review_cost_usd", "matched_qualifying_human", "unmatched_qualifying_human_count", "collection_status"];

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

export function summarizeMetrics(records) {
  const findings = records.filter((record) => record.record_type !== "human_baseline");
  const outcomes = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, findings.filter((record) => record.outcome === outcome).length]));
  const classified = findings.length - outcomes.unclassified;
  const percentile = (field, fraction) => {
    const values = findings.map((record) => record[field]).filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? values[Math.ceil(values.length * fraction) - 1] : null;
  };
  const breakdown = (field) => Object.fromEntries([...new Set(findings.map((record) => record[field] ?? "unknown"))].sort().map((value) => {
    const selected = findings.filter((record) => (record[field] ?? "unknown") === value);
    return [value, { total: selected.length, accepted: selected.filter((record) => record.outcome === "accepted").length, disputed: selected.filter((record) => record.outcome === "disputed").length }];
  }));
  const matchedAccepted = findings.filter((record) => record.outcome === "accepted" && record.matched_qualifying_human === true).length;
  const unmatchedHuman = records.reduce((sum, record) => sum + (record.unmatched_qualifying_human_count ?? 0), 0);
  const precisionDenominator = outcomes.accepted + outcomes.disputed;
  const confidence = Object.fromEntries(["high", "medium", "low", "unknown"].map((value) => [value, findings.filter((record) => (record.confidence ?? "unknown") === value).length]).filter(([, count]) => count));
  return {
    schema_version: 1,
    generated_from: "sanitized_metadata",
    total_findings: findings.length,
    outcomes,
    acceptance_rate: ratio(outcomes.accepted, findings.length),
    classification_rate: ratio(classified, findings.length),
    observed_precision: ratio(outcomes.accepted, precisionDenominator),
    estimated_recall: ratio(matchedAccepted, matchedAccepted + unmatchedHuman),
    breakdowns: { repository: breakdown("repository"), severity: breakdown("severity"), model: breakdown("model") },
    latency_ms: { p50: percentile("review_latency_ms", 0.5), p95: percentile("review_latency_ms", 0.95) },
    cost_usd: { p50: percentile("review_cost_usd", 0.5), p95: percentile("review_cost_usd", 0.95) },
    counts: { rejected: outcomes.disputed, failed: findings.filter((record) => record.collection_status === "failed").length, confidence },
  };
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export async function renderDashboard(records, outputDirectory, { generatedAt = new Date().toISOString(), auditSampleSize = 25 } = {}) {
  const sorted = records
    .map((record) => Object.fromEntries(APPROVED_FIELDS.map((field) => [field, record[field] ?? null])))
    .sort((left, right) => `${left.finding_created_at}/${left.finding_id}`.localeCompare(`${right.finding_created_at}/${right.finding_id}`));
  const summary = { ...summarizeMetrics(sorted), generated_at: generatedAt };
  const audit = { schema_version: 1, generated_at: generatedAt, records: sorted.slice(0, auditSampleSize) };
  const rows = sorted.map((record) => `<tr><td>${escapeHtml(record.repository)}</td><td>${record.pr_number}</td><td>${escapeHtml(record.dimension)}</td><td>${escapeHtml(record.severity)}</td><td>${escapeHtml(record.outcome)}</td></tr>`).join("\n");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>AI Review Metrics</title><style>body{font:16px system-ui;max-width:72rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.5rem;text-align:left}</style><h1>AI Review Metrics</h1><p>Findings: ${summary.total_findings}. Acceptance rate: ${summary.acceptance_rate ?? "N/A"}. Classification rate: ${summary.classification_rate ?? "N/A"}.</p><table><thead><tr><th>Repository</th><th>PR</th><th>Dimension</th><th>Severity</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table></html>\n`;
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "audit-sample.json"), `${JSON.stringify(audit, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "index.html"), html),
  ]);
  return summary;
}

async function main() {
  const records = JSON.parse(await readFile(process.argv[2], "utf8"));
  await renderDashboard(records, process.argv[3]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

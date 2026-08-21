import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateCell, type ActualFinding, type ExpectedFinding } from "./evaluate.js";

interface CorpusEntry {
  id: string;
  files: Array<{ path: string; content: string }>;
  expected_findings: ExpectedFinding[];
}

interface CellOutput {
  model: string;
  entryId: string;
  repeat: number;
  ok: boolean;
  error?: string;
  precision: number | null;
  recall: number | null;
  severity_match_rate: number | null;
  rule_citation_rate: number | null;
  total_tokens?: number;
  elapsed_ms?: number;
}

function sh(cmd: string, args: string[], opts: { cwd?: string } = {}): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function materialize(entry: CorpusEntry): string {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  sh("git", ["init", "-q"], { cwd: dir });
  sh("git", ["config", "user.email", "bench@toolkit"], { cwd: dir });
  sh("git", ["config", "user.name", "bench"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# bench\n");
  sh("git", ["add", "."], { cwd: dir });
  sh("git", ["commit", "-qm", "base"], { cwd: dir });
  for (const f of entry.files) {
    mkdirSync(join(dir, f.path, ".."), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  sh("git", ["add", "."], { cwd: dir });
  sh("git", ["commit", "-qm", "head"], { cwd: dir });
  return dir;
}

function runOcr(model: string, entry: CorpusEntry, distRoot: string, defaultsDir: string): { actual: ActualFinding[]; tokens: number; elapsedMs: number } {
  const dir = materialize(entry);
  try {
    const tmp = join(dir, ".bench");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "changed-files.json"), JSON.stringify(entry.files.map((f) => f.path)));
    sh("node", [join(distRoot, "context/resolve-manifest.js"), join(dir, "REVIEW.md-absent"), join(defaultsDir, "REVIEW.md"), join(defaultsDir, "manifest-defaults.json"), join(tmp, "changed-files.json"), dir, join(tmp, "manifest.json"), join(tmp, "status.json")]);
    const compileScript = `
      import { compileOcrRules } from ${JSON.stringify(join(distRoot, "ocr/compile-ocr-rules.js"))};
      import { readFileSync, writeFileSync } from 'node:fs';
      const manifest = JSON.parse(readFileSync(process.argv[1], 'utf8'));
      let policyBody = '';
      try { policyBody = JSON.parse(readFileSync(process.argv[3], 'utf8')).defaultPolicyBody || ''; } catch {}
      const rules = compileOcrRules({ workspace: process.argv[4], changedFiles: [], orgContextsDir: ${JSON.stringify(join(distRoot, "../context/contexts"))}, manifest, policyBody, resolvedDirectives: [], orgProfiles: ['backend/security', 'backend/sre'] });
      writeFileSync(process.argv[2], JSON.stringify(rules));
    `;
    sh("node", ["--input-type=module", "-e", compileScript, join(tmp, "manifest.json"), join(tmp, "rule.json"), join(tmp, "status.json"), dir]);

    sh("ocr", ["config", "set", "llm.model", model]);
    const raw = execFileSync("ocr", ["review", "--from", "HEAD~1", "--to", "HEAD", "--rule", join(tmp, "rule.json"), "--format", "json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const findings = Array.isArray(parsed) ? parsed : (parsed.comments || []);
    const actual: ActualFinding[] = findings.map((f: { file?: string; path?: string; line?: number; start_line?: number; severity?: string; message?: string; content?: string }) => ({
      path: f.path || f.file || "",
      line: f.line ?? f.start_line ?? 0,
      severity: f.severity || "INFO",
      body: f.message || f.content || "",
    }));
    const summary = parsed.summary || {};
    return {
      actual,
      tokens: Number(summary.total_tokens) || 0,
      elapsedMs: Number(parsed.manifest?.elapsed_ms) || 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const distRoot = join(import.meta.dirname, "..");
  const defaultsDir = join(distRoot, "../context/defaults");
  const corpusPath = args.find((a) => !a.startsWith("--")) || join(distRoot, "../src/benchmark/corpus/golden.json");
  const models = (args.find((a) => a.startsWith("--models="))?.slice(9) || "deepseek/deepseek-v4-pro").split(",");
  const repeats = Number(args.find((a) => a.startsWith("--repeats="))?.slice(10) || 3);
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { entries: CorpusEntry[] };

  try {
    sh("ocr", ["--version"]);
  } catch {
    process.stderr.write("ocr CLI not found — npm install -g @alibaba-group/open-code-review\n");
    process.exit(1);
  }
  if (process.env.OCR_LLM_URL) sh("ocr", ["config", "set", "llm.url", process.env.OCR_LLM_URL]);
  if (process.env.OCR_LLM_TOKEN) sh("ocr", ["config", "set", "llm.auth_token", process.env.OCR_LLM_TOKEN]);
  sh("ocr", ["config", "set", "llm.protocol", "openai"]);

  const cells: CellOutput[] = [];
  for (const model of models) {
    for (const entry of corpus.entries) {
      for (let repeat = 1; repeat <= repeats; repeat++) {
        try {
          const { actual, tokens, elapsedMs } = runOcr(model, entry, distRoot, defaultsDir);
          const r = evaluateCell(entry.expected_findings, actual);
          cells.push({ model, entryId: entry.id, repeat, ok: true, ...r, total_tokens: tokens, elapsed_ms: elapsedMs });
          process.stdout.write(`ok ${model} ${entry.id} #${repeat}\n`);
        } catch (error) {
          cells.push({ model, entryId: entry.id, repeat, ok: false, error: (error as Error).message, precision: null, recall: null, severity_match_rate: null, rule_citation_rate: null });
          process.stdout.write(`ERROR ${model} ${entry.id} #${repeat}: ${(error as Error).message}\n`);
        }
      }
    }
  }

  const outPath = args.find((a) => a.startsWith("--out="))?.slice(6) || `docs/plans/${new Date().toISOString().slice(0, 10)}-model-benchmark-results.md`;
  const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const fmt = (x: number | null) => (x != null ? x.toFixed(2) : "—");
  let md = `# Model Benchmark Results\n\n**Corpus:** ${corpusPath} | **Repeats:** ${repeats} | **Date:** ${new Date().toISOString()}\n\n`;
  md += `| Model | Precision | Recall | Severity match | Rule citation | Avg tokens | Avg elapsed ms | Errors |\n|---|---|---|---|---|---|---|---|\n`;
  for (const model of models) {
    const mc = cells.filter((c) => c.model === model);
    md += `| ${model} | ${fmt(mean(mc.filter((c) => c.precision != null).map((c) => c.precision!)))} | ${fmt(mean(mc.filter((c) => c.recall != null).map((c) => c.recall!)))} | ${fmt(mean(mc.filter((c) => c.severity_match_rate != null).map((c) => c.severity_match_rate!)))} | ${fmt(mean(mc.filter((c) => c.rule_citation_rate != null).map((c) => c.rule_citation_rate!)))} | ${Math.round(mean(mc.map((c) => c.total_tokens ?? 0)) ?? 0)} | ${Math.round(mean(mc.map((c) => c.elapsed_ms ?? 0)) ?? 0)} | ${mc.filter((c) => !c.ok).length} |\n`;
  }
  md += `\n## Per-cell detail\n\n| Model | Entry | Repeat | Precision | Recall | Error |\n|---|---|---|---|---|---|\n`;
  for (const c of cells) {
    md += `| ${c.model} | ${c.entryId} | ${c.repeat} | ${c.precision ?? "—"} | ${c.recall ?? "—"} | ${c.error ?? ""} |\n`;
  }
  writeFileSync(outPath, md);
  process.stdout.write(`wrote ${outPath}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("run-matrix.js")) {
  main();
}

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { probeMcp } from "../poc/serena/benchmark-client.mjs";

const SHA = /^[0-9a-f]{40}$/i;

export function validateReadinessReport(report, revision) {
  if (!/Status:\s*`READY_FOR_ADS_POC`/.test(report ?? "")) throw new Error("Serena is not approved by the readiness report");
  const approvedRevision = report.match(/Serena revision:\s*`([0-9a-f]{40})`/i)?.[1];
  if (approvedRevision?.toLowerCase() !== revision.toLowerCase()) throw new Error("Serena readiness revision does not match the requested revision");
}

function healthProbe(options) {
  const command = [path.join(options.serenaHome, "bin", "serena-readonly"), options.workspace];
  const env = { HOME: options.home, PATH: options.pathValue, SERENA_HOME: options.serenaHome };
  return probeMcp({ command, timeoutMs: options.probeTimeoutMs ?? 30_000, env });
}

function runSetup({ setupScript, revision, serenaHome, home, pathValue, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn("bash", [setupScript, revision], { env: { HOME: home, PATH: pathValue, SERENA_HOME: serenaHome }, stdio: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); resolve({ status: "unavailable", reason: "setup_failed" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve(timedOut ? { status: "timed_out", reason: "setup_timed_out" } : code === 0 ? { status: "available", reason: "pinned_wrapper_ready" } : { status: "unavailable", reason: "setup_failed" }); });
  });
}

export async function prepareSerena(options) {
  if (!options.enabled) {
    const status = { schema_version: 1, status: "disabled", revision: "0".repeat(40), reason: "disabled_by_configuration" };
    await writeFile(options.statusPath, `${JSON.stringify(status)}\n`);
    return status;
  }
  if (!SHA.test(options.revision ?? "")) throw new Error("Serena revision must be an exact 40-character commit SHA");
  const readinessReport = options.readinessReport ?? await readFile(options.readinessReportPath, "utf8");
  validateReadinessReport(readinessReport, options.revision);
  await mkdir(options.serenaHome, { recursive: true });
  let result = await (options.runSetup ?? runSetup)({ ...options, timeoutMs: options.timeoutMs ?? 120_000 });
  if (result.status === "available") result = await (options.runHealthProbe ?? healthProbe)(options);
  const warning = result.status === "available" ? {} : { warning: `Serena setup ${result.status === "timed_out" ? "timed out" : "failed"}; review continued without Serena.` };
  const status = { schema_version: 1, ...result, revision: options.revision, ...warning };
  await writeFile(options.statusPath, `${JSON.stringify(status)}\n`);
  if (result.status === "available") {
    const analysis = JSON.parse(await readFile(options.analysisInput, "utf8"));
    analysis.mcp = { serena: { type: "local", command: [path.join(options.serenaHome, "bin", "serena-readonly"), analysis.workspace], enabled: true } };
    analysis.mcpTrustedRoot = options.serenaHome;
    await writeFile(options.analysisInput, JSON.stringify(analysis));
  }
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [enabled, revision, serenaHome, workspace, analysisInput, statusPath, setupScript, readinessReportPath] = process.argv.slice(2);
  await prepareSerena({ enabled: enabled === "true", revision, serenaHome, workspace, analysisInput, statusPath, setupScript, readinessReportPath, home: process.env.HOME, pathValue: process.env.PATH });
}

import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

class McpClient {
  constructor(command, timeoutMs, env) {
    this.child = spawn(command[0], command.slice(1), { env, stdio: ["pipe", "pipe", "ignore"] });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.pending = new Map();
    this.nextId = 1;
    this.timeoutMs = timeoutMs;
    this.lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message ?? "MCP error")) : pending.resolve(message.result);
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`MCP ${method} timed out`), { code: "MCP_TIMEOUT" }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close() {
    this.lines.close();
    this.child.kill("SIGTERM");
  }
}

const elapsedMs = (started) => Number(process.hrtime.bigint() - started) / 1e6;

async function initialize(client) {
  await client.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "serena-benchmark", version: "1" } });
  client.notify("notifications/initialized");
  return client.request("tools/list");
}

export async function probeMcp({ command, timeoutMs, env }) {
  let client;
  try {
    client = new McpClient(command, timeoutMs, env);
    const listed = await initialize(client);
    return Array.isArray(listed.tools)
      ? { status: "available", reason: "mcp_tools_ready" }
      : { status: "unavailable", reason: "mcp_probe_failed" };
  } catch (error) {
    return { status: error.code === "MCP_TIMEOUT" ? "timed_out" : "unavailable", reason: error.code === "MCP_TIMEOUT" ? "mcp_probe_timed_out" : "mcp_probe_failed" };
  } finally {
    client?.close();
  }
}

async function platformMeasurement(pid, diskPath) {
  const [{ stdout: rss }, { stdout: disk }] = await Promise.all([
    execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]),
    execFileAsync("du", ["-sk", diskPath]),
  ]);
  return { rss_bytes: Number.parseInt(rss.trim(), 10) * 1024, disk_bytes: Number.parseInt(disk.trim().split(/\s+/)[0], 10) * 1024 };
}

function textContent(result) {
  return (result?.content ?? []).map((item) => item.text ?? "").join("\n");
}

export async function runBenchmark({ command, corpusPath, timeoutMs, diskPath, pairedInputs }) {
  const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
  let cold;
  let warm;
  try {
    cold = new McpClient(command, timeoutMs);
    const coldStarted = process.hrtime.bigint();
    await initialize(cold);
    const coldSetupMs = elapsedMs(coldStarted);
    cold.close();

    warm = new McpClient(command, timeoutMs);
    const warmStarted = process.hrtime.bigint();
    const listed = await initialize(warm);
    const warmSetupMs = elapsedMs(warmStarted);
    const availableTools = new Set((listed.tools ?? []).map(({ name }) => name));
    const resources = await platformMeasurement(warm.child.pid, diskPath);
    const samples = [];
    for (const fixture of corpus) {
      const started = process.hrtime.bigint();
      const result = availableTools.has(fixture.tool)
        ? await warm.request("tools/call", { name: fixture.tool, arguments: fixture.arguments ?? {} })
        : null;
      samples.push({
        fixture: fixture.fixture,
        status: "available",
        compatible: result !== null && textContent(result).includes(fixture.expected),
        cold_setup_ms: coldSetupMs,
        warm_setup_ms: warmSetupMs,
        review_latency_ms: elapsedMs(started),
        ...resources,
        ...pairedInputs,
      });
      samples.at(-1).serena_ms = samples.at(-1).review_latency_ms;
    }
    return samples;
  } catch (error) {
    return corpus.map(({ fixture }) => ({ fixture, status: error.code === "MCP_TIMEOUT" ? "timed_out" : "unavailable", compatible: false }));
  } finally {
    cold?.close();
    warm?.close();
  }
}

async function main() {
  const [commandJson, corpusPath, outputPath, diskPath] = process.argv.slice(2);
  if (!commandJson || !corpusPath || !outputPath || !diskPath) throw new Error("usage: benchmark-client.mjs <command-json> <corpus.json> <output.jsonl> <disk-path>");
  const samples = await runBenchmark({
    command: JSON.parse(commandJson),
    corpusPath,
    timeoutMs: Number(process.env.SERENA_BENCHMARK_TIMEOUT_MS ?? 60_000),
    diskPath,
    pairedInputs: JSON.parse(process.env.SERENA_PAIRED_INPUTS ?? "{}"),
  });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

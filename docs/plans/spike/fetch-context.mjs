import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_DIR = process.env.PROJECT_DIR || "/Users/trinaldirizki/go/src/github.com/astronautsid/astro-ads-be";
const CHANGED_FILE = process.env.CHANGED_FILE || "internal/domain/creditmanager/service/process_spending_seller_events.go";
const CHANGED_SYMBOL = process.env.CHANGED_SYMBOL || "ProcessSpendingSellerEvents";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "/tmp/spike/serena-context.md";
const MAX_BYTES = 8192;
const SERENA_CMD = process.env.SERENA_CMD || "serena";

let nextId = 1;
const pending = new Map();

function send(stream, method, params) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  process.stderr.write(`[spike:mcp] -> ${method} (id=${id})\n`);
  stream.write(msg);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function notify(stream, method, params) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
  process.stderr.write(`[spike:mcp] -> ${method} (notification)\n`);
  stream.write(msg);
}

async function main() {
  const filePath = resolve(PROJECT_DIR, CHANGED_FILE);

  process.stderr.write(`[spike] Starting serena MCP server for project: ${PROJECT_DIR}\n`);
  process.stderr.write(`[spike] Changed file: ${CHANGED_FILE}\n`);
  process.stderr.write(`[spike] Changed symbol: ${CHANGED_SYMBOL}\n`);

  const proc = spawn(SERENA_CMD, ["start-mcp-server", "--project", PROJECT_DIR], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, HOME: process.env.HOME },
  });

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  let buffer = "";
  rl.on("line", (line) => {
    process.stderr.write(`[spike:mcp] <- ${line.slice(0, 200)}${line.length > 200 ? "..." : ""}\n`);
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`MCP error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    } catch {
      buffer += line;
    }
  });

  proc.stderr.on("data", (d) => process.stderr.write(`[spike:serena:stderr] ${d.toString().trim()}\n`));

  const exitPromise = new Promise((_, reject) => {
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`serena exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  try {
    process.stderr.write("[spike] Sending initialize...\n");
    const initResult = await send(proc.stdin, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "spike-v4.4-fetcher", version: "1.0" },
    });
    process.stderr.write(`[spike] Server: ${initResult?.serverInfo?.name || "unknown"} v${initResult?.serverInfo?.version || "?"}\n`);

    notify(proc.stdin, "notifications/initialized", {});

    process.stderr.write(`[spike] Calling get_symbols_overview for ${CHANGED_FILE}...\n`);
    const overviewResult = await send(proc.stdin, "tools/call", {
      name: "get_symbols_overview",
      arguments: { relative_path: CHANGED_FILE },
    });

    process.stderr.write(`[spike] Calling find_referencing_symbols for ${CHANGED_SYMBOL}...\n`);
    const refsResult = await send(proc.stdin, "tools/call", {
      name: "find_referencing_symbols",
      arguments: {
        name_path: CHANGED_SYMBOL,
        relative_path: CHANGED_FILE,
      },
    });

    const overviewText = overviewResult?.content?.[0]?.text || JSON.stringify(overviewResult);
    const refsText = refsResult?.content?.[0]?.text || JSON.stringify(refsResult);

    // Build bounded context artifact
    let context = `## Semantic context (Serena)

### Symbol: \`${CHANGED_SYMBOL}\`

**Overview:**
${overviewText}

**Referencing symbols:**
${refsText}
`;

    if (Buffer.byteLength(context, "utf8") > MAX_BYTES) {
      const truncated = context.slice(0, MAX_BYTES - 100);
      context = truncated + "\n\n... (truncated for --background-file budget)\n";
    }

    writeFileSync(OUTPUT_FILE, context, "utf8");
    process.stderr.write(`[spike] Wrote ${Buffer.byteLength(context, "utf8")} bytes to ${OUTPUT_FILE}\n`);

    process.stderr.write("[spike] S1: driver exited cleanly, no review text emitted\n");
  } catch (err) {
    process.stderr.write(`[spike] ERROR: ${err.message}\n`);
    process.exit(1);
  } finally {
    proc.kill();
  }

  process.exit(0);
}

main();

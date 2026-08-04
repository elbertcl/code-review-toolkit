import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

interface EnumerateResult {
  files: string[];
  overflow: boolean;
}

interface SymbolRef {
  symbol: string;
  references: string[];
}

export function enumerateTargets(changedFiles: string[] | null | undefined, cap: number): EnumerateResult {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  if (files.length <= cap) return { files: [...files], overflow: false };
  return { files: files.slice(0, cap), overflow: true };
}

export function formatPointerArtifact(refs: SymbolRef[] | null | undefined, budget: number): string {
  if (!Array.isArray(refs) || refs.length === 0) return "";
  const lines: string[] = [];
  let bytes = 0;
  for (const ref of refs) {
    const line = `- ${ref.symbol} referenced by: ${ref.references.join(", ")}`;
    const lineBytes = Buffer.byteLength(line + "\n");
    if (bytes + lineBytes > budget - 14) {
      lines.push("…[truncated]");
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  return lines.join("\n");
}

interface FetchOptions {
  projectDir: string;
  changedFiles: string[];
  cap: number;
  serenaPath?: string;
  outputPath?: string;
  timeoutMs?: number;
}

interface FetchResult {
  artifact: string;
  artifactBytes: number;
  overflow: boolean;
  error?: string;
}

export async function fetchSerenaContext(options: FetchOptions): Promise<FetchResult> {
  const { projectDir, changedFiles, cap, serenaPath = "serena", outputPath, timeoutMs = 30000 } = options;
  const { files, overflow } = enumerateTargets(changedFiles, cap);

  if (files.length === 0) {
    const empty: FetchResult = { artifact: "", artifactBytes: 0, overflow: false };
    if (outputPath) writeFileSync(outputPath, "");
    return empty;
  }

  try {
    const child = spawn(serenaPath, ["start-mcp-server", "--project", projectDir], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let buffer = "";
    let messageId = 0;

    const send = (msg: Record<string, unknown>): void => {
      messageId += 1;
      const payload = JSON.stringify({ jsonrpc: "2.0", id: messageId, ...msg });
      child.stdin!.write(payload + "\n");
    };

    const readResponse = (): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        const onData = (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
                child.stdout!.removeListener("data", onData);
                resolve(msg);
                return;
              }
            } catch {
              // not JSON, skip
            }
          }
        };
        child.stdout!.on("data", onData);
        child.on("close", (code) => {
          child.stdout!.removeListener("data", onData);
          if (code !== 0) reject(new Error(`Serena exited with code ${code}`));
        });
        child.on("error", (err) => {
          child.stdout!.removeListener("data", onData);
          reject(err);
        });
      });
    };

    // Initialize handshake
    send({ method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "serena-fetcher", version: "1.0.0" } } });
    await readResponse();

    send({ method: "notifications/initialized" });

    const symbolRefs: SymbolRef[] = [];

    for (const file of files) {
      try {
        send({ method: "tools/call", params: { name: "get_symbols_overview", arguments: { relative_path: file } } });
        const overviewResp = await readResponse();

        if (overviewResp.error) continue;

        const result = overviewResp.result as { content?: Array<{ type: string; text?: string }> } | undefined;
        const text = result?.content?.find((c) => c.type === "text")?.text;
        if (!text) continue;

        const symbols: string[] = [];
        for (const line of text.split("\n")) {
          const match = line.match(/^\s*[-*]\s+`?(\w+)`?/);
          if (match) symbols.push(match[1]);
        }

        for (const sym of symbols.slice(0, 20)) {
          send({ method: "tools/call", params: { name: "find_referencing_symbols", arguments: { name_path: sym, relative_path: file } } });
          const refResp = await readResponse();
          if (refResp.error) continue;

          const refResult = refResp.result as { content?: Array<{ type: string; text?: string }> } | undefined;
          const refText = refResult?.content?.find((c) => c.type === "text")?.text;
          if (!refText) continue;

          const refs: string[] = [];
          for (const refLine of refText.split("\n")) {
            const refMatch = refLine.match(/^\s*[-*]\s+(\S+:\d+)/);
            if (refMatch) refs.push(refMatch[1]);
          }

          if (refs.length > 0) {
            symbolRefs.push({ symbol: sym, references: refs });
          }
        }
      } catch {
        // fail-open: skip this file
      }
    }

    child.kill();

    const ARTIFACT_BUDGET = 2048;
    const artifact = formatPointerArtifact(symbolRefs, ARTIFACT_BUDGET);
    const result: FetchResult = {
      artifact,
      artifactBytes: Buffer.byteLength(artifact),
      overflow,
    };

    if (outputPath) writeFileSync(outputPath, artifact);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const empty: FetchResult = { artifact: "", artifactBytes: 0, overflow: false, error };
    if (outputPath) writeFileSync(outputPath, "");
    return empty;
  }
}

if (process.argv[1] && process.argv[1].endsWith("fetch-serena-context.js")) {
  const projectDir = process.argv[2];
  const changedPath = process.argv[3];
  const cap = parseInt(process.argv[4] || "20", 10);
  const outputPath = process.argv[5];

  if (!projectDir || !changedPath) {
    process.stderr.write("Usage: node fetch-serena-context.js <project-dir> <changed-files.json> [cap] [output.md]\n");
    process.exit(1);
  }

  const { readFileSync } = await import("node:fs");
  const changedFiles = JSON.parse(readFileSync(changedPath, "utf8")) as string[];

  fetchSerenaContext({ projectDir, changedFiles, cap, outputPath }).then((result) => {
    process.stdout.write(result.artifact || "");
    if (result.error) {
      process.stderr.write(`Serena fetcher: ${result.error} (fail-open, continuing)\n`);
    }
  }).catch((err: Error) => {
    process.stderr.write(`Serena fetcher: ${err.message} (fail-open, continuing)\n`);
  });
}
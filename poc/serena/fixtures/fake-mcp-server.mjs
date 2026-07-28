import readline from "node:readline";

const hang = process.argv.includes("--hang");
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === "notifications/initialized") continue;
  if (hang && request.method === "tools/call") continue;
  let result;
  if (request.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake-serena", version: "1" } };
  if (request.method === "tools/list") result = { tools: [{ name: "find_symbol" }, { name: "find_referencing_symbols" }] };
  if (request.method === "tools/call") result = { content: [{ type: "text", text: request.params.name === "find_symbol" ? "collectMetrics" : "collectMetrics.test" }] };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
}

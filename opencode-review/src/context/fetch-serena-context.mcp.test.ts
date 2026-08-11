import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fetchSerenaContext } from "./fetch-serena-context.js";

interface FakeChildProcess extends EventEmitter {
  stdin: { write: (data: string) => void };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
}

interface MockResponse {
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function createFakeChildProcess(responses: MockResponse[]): {
  child: FakeChildProcess;
  spawnFn: (path: string, args: string[]) => FakeChildProcess;
} {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as unknown as FakeChildProcess;
  let responseIndex = 0;

  child.stdin = {
    write(data: string) {
      let request: Record<string, unknown>;
      try {
        request = JSON.parse(data);
      } catch {
        return;
      }
      if (request.id == null) return;
      if (typeof request.method === "string" && (request.method as string).startsWith("notifications/")) return;
      const response = { ...responses[responseIndex++] };
      if (Object.keys(response).length === 1 && response.id !== undefined) return;
      (response as Record<string, unknown>).id = request.id;
      process.nextTick(() => {
        stdout.emit("data", Buffer.from(JSON.stringify(response) + "\n"));
      });
    },
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {};

  return {
    child,
    spawnFn: () => child,
  };
}

function buildInitResponse(): MockResponse {
  return {
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: "serena", version: "1.0.0" },
    },
  };
}

function buildOverviewResponse(symbols: string): MockResponse {
  return {
    result: {
      content: [{ type: "text", text: symbols }],
    },
  };
}

function buildRefResponse(refs: string): MockResponse {
  return {
    result: {
      content: [{ type: "text", text: refs }],
    },
  };
}

describe("fetchSerenaContext MCP client", () => {
  it("returns non-empty artifact for single file with symbols", async () => {
    const { spawnFn } = createFakeChildProcess([
      buildInitResponse(),
      buildOverviewResponse("- `ProcessEvent`\n- HandlePayment\n"),
      buildRefResponse("- service.go:42\n- handler.go:15\n"),
      buildRefResponse("- payment.go:30\n"),
    ]);

    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: ["service.go"],
      cap: 20,
      _spawn: spawnFn as any,
    });

    assert.ok(result.artifact.length > 0, "artifact should not be empty");
    assert.match(result.artifact, /ProcessEvent/);
    assert.match(result.artifact, /HandlePayment/);
    assert.match(result.artifact, /service\.go:42/);
    assert.match(result.artifact, /referenced by:/);
    assert.equal(result.artifactBytes, Buffer.byteLength(result.artifact));
    assert.equal(result.overflow, false);
    assert.equal(result.error, undefined);
  });

  it("returns empty artifact when no symbols found", async () => {
    const { spawnFn } = createFakeChildProcess([
      buildInitResponse(),
      buildOverviewResponse(""),
    ]);

    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: ["empty.go"],
      cap: 20,
      _spawn: spawnFn as any,
    });

    assert.equal(result.artifact, "");
    assert.equal(result.artifactBytes, 0);
    assert.equal(result.error, undefined);
  });

  it("skips file on MCP tool error (get_symbols_overview)", async () => {
    const { spawnFn } = createFakeChildProcess([
      buildInitResponse(),
      { error: { code: -32603, message: "Internal error" } },
    ]);

    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: ["broken.go"],
      cap: 20,
      _spawn: spawnFn as any,
    });

    assert.equal(result.artifact, "");
    assert.equal(result.artifactBytes, 0);
    assert.equal(result.error, undefined);
  });

  it("skips file on MCP tool error (find_referencing_symbols)", async () => {
    const { spawnFn } = createFakeChildProcess([
      buildInitResponse(),
      buildOverviewResponse("- `Func1`\n"),
      { error: { code: -32603, message: "Symbol not found" } },
    ]);

    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: ["broken.go"],
      cap: 20,
      _spawn: spawnFn as any,
    });

    assert.equal(result.artifact, "");
    assert.equal(result.error, undefined);
  });

  it("returns empty artifact on spawn timeout", async () => {
    const spawnFn = () => {
      const child = createFakeChildProcess([]).child;
      setTimeout(() => child.emit("close", 1), 10);
      return child;
    };

    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: ["a.go"],
      cap: 20,
      timeoutMs: 50,
      _spawn: spawnFn as any,
    });

    assert.equal(result.artifact, "");
    assert.ok(result.error, "error message should be present on timeout");
    assert.match(result.error!, /exited|timeout/i);
  });

  it("handles empty changed files gracefully", async () => {
    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: [],
      cap: 20,
    });

    assert.equal(result.artifact, "");
    assert.equal(result.artifactBytes, 0);
    assert.equal(result.overflow, false);
    assert.equal(result.error, undefined);
  });

  it("handles malformed response (non-JSON on stdout)", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as unknown as FakeChildProcess;

    child.stdin = {
      write(data: string) {
        let request: Record<string, unknown>;
        try {
          request = JSON.parse(data);
        } catch {
          return;
        }
        if (request.id == null) return;
        if (typeof request.method === "string" && (request.method as string).startsWith("notifications/")) return;
        if (request.id === 1) {
          process.nextTick(() => {
            stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "serena", version: "1.0.0" } } }) + "\n"));
          });
        } else if (request.id === 3) {
          process.nextTick(() => {
            stdout.emit("data", Buffer.from("garbage not json\n"));
            stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "- `Func1`\n" }] } }) + "\n"));
          });
        } else if (request.id === 4) {
          process.nextTick(() => {
            stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "- a.go:10\n" }] } }) + "\n"));
          });
        }
      },
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {};

    const spawnFn = () => child;

    const result = await fetchSerenaContext({
      projectDir: "/tmp/test-project",
      changedFiles: ["a.go"],
      cap: 20,
      _spawn: spawnFn as any,
    });

    assert.ok(result.artifact.includes("Func1"), "should parse valid response after garbage");
    assert.ok(result.artifact.includes("a.go:10"));
  });
});

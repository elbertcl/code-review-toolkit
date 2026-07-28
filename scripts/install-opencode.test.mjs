import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installOpenCode } from "./install-opencode.mjs";

test("downloads an exact HTTPS release asset, verifies its digest, then verifies version", async () => {
  const bytes = Buffer.from("binary");
  const destination = path.join(await mkdtemp(path.join(os.tmpdir(), "opencode-install-")), "bin/opencode");
  let verified;
  await installOpenCode({ url: "https://github.com/anomalyco/opencode/releases/download/v1.2.3/opencode-linux-x64", sha256: createHash("sha256").update(bytes).digest("hex"), version: "1.2.3", destination, fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }), verifyVersion: async (executable, version) => { verified = { executable, version }; } });
  assert.deepEqual(await readFile(destination), bytes);
  assert.deepEqual(verified, { executable: destination, version: "1.2.3" });
});

test("rejects mutable URLs and digest mismatches before version execution", async () => {
  const destination = path.join(await mkdtemp(path.join(os.tmpdir(), "opencode-install-bad-")), "opencode");
  const common = { sha256: "0".repeat(64), version: "1.2.3", destination, fetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from("bad") }), verifyVersion: async () => { throw new Error("must not run"); } };
  await assert.rejects(() => installOpenCode({ ...common, url: "http://example.test/latest" }), /immutable HTTPS release asset/);
  await assert.rejects(() => installOpenCode({ ...common, url: "https://github.com/anomalyco/opencode/releases/latest/download/opencode" }), /immutable HTTPS release asset/);
  await assert.rejects(() => installOpenCode({ ...common, url: "https://github.com/anomalyco/opencode/releases/download/v1.2.3/opencode-linux-x64" }), /SHA-256 mismatch/);
});

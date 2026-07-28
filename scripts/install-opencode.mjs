import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyOpenCodeVersion } from "./validate-runtime.mjs";

function immutableReleaseUrl(value, version) {
  let url;
  try { url = new URL(value); } catch { throw new Error("opencode_download_url must be an immutable HTTPS release asset"); }
  const exactTag = `/releases/download/v${version}/`;
  if (url.protocol !== "https:" || !url.pathname.includes(exactTag) || /\/latest\//.test(url.pathname)) throw new Error("opencode_download_url must be an immutable HTTPS release asset for the exact version");
  return url;
}

function versionOutput(executable) {
  return new Promise((resolve, reject) => execFile(executable, ["--version"], { timeout: 15_000, encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

export async function installOpenCode({ url, sha256, version, destination, fetch = globalThis.fetch, verifyVersion = async (executable, expected) => verifyOpenCodeVersion(expected, () => versionOutput(executable)) }) {
  immutableReleaseUrl(url, version);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("opencode_sha256 must be a lowercase SHA-256 digest");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OpenCode download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`OpenCode SHA-256 mismatch: expected ${sha256}, got ${actual}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { mode: 0o755 });
  await chmod(destination, 0o755);
  await verifyVersion(destination, version);
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  installOpenCode({ url: process.argv[2], sha256: process.argv[3], version: process.argv[4], destination: process.argv[5] })
    .then((destination) => process.stdout.write(`${destination}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

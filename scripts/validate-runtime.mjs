import { fileURLToPath } from "node:url";

export function validateToolkitSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error("toolkit_sha must be a lowercase 40-character commit SHA");
  return value;
}

export async function verifyOpenCodeVersion(expected, getVersion) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected ?? "")) throw new Error("opencode_version must be an exact semantic version");
  const actual = String(await getVersion()).trim().replace(/^v/, "");
  if (actual !== expected) throw new Error(`expected ${expected}, found ${actual}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [operation, value] = process.argv.slice(2);
  const run = operation === "toolkit-sha"
    ? async () => validateToolkitSha(value)
    : operation === "opencode-version"
      ? async () => verifyOpenCodeVersion(value, async () => {
        const { execFileSync } = await import("node:child_process");
        return execFileSync("opencode", ["--version"], { encoding: "utf8" });
      })
      : async () => { throw new Error("unknown validation operation"); };
  run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

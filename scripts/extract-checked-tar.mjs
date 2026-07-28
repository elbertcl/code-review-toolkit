import { execFileSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACTS = {
  analysis: new Set(["findings.json", "review-state.json", "changed-files.json", "addressable-lines.json", "serena-status.json"]),
  blocked: new Set(["blocked-comment.md"]),
  preflight: new Set(["changed-files.json", "addressable-lines.json", "review.diff", "review_context.md", "review_context.metadata.json", "review-state.json"]),
};
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_MEMBERS = 100;

function validateMember({ name, type = "file" }, allowlist) {
  const normalized = path.posix.normalize(name.replace(/^\.\//, ""));
  if (!normalized || normalized === "." || path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) throw new Error(`unsafe tar member: ${name}`);
  if (type !== "file") throw new Error(`unsupported tar member: ${name}`);
  if (!allowlist.has(normalized)) throw new Error(`tar member is not allowlisted for artifact type: ${name}`);
  return normalized;
}

function validateEntries(entries, allowlist) {
  if (entries.length > MAX_MEMBERS) throw new Error("artifact member count exceeds limit");
  const names = new Set();
  let expanded = 0;
  return entries.map((entry) => {
    const name = validateMember(entry, allowlist);
    if (names.has(name)) throw new Error(`duplicate tar member: ${name}`);
    names.add(name);
    const size = Buffer.byteLength(entry.data ?? "");
    if (size > MAX_FILE_BYTES) throw new Error(`artifact file size exceeds limit: ${name}`);
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("artifact expanded size exceeds limit");
    return { ...entry, name };
  });
}

function requireExactMembers(entries, allowlist) {
  const names = new Set(entries.map(({ name }) => name));
  if (names.size !== allowlist.size || [...allowlist].some((name) => !names.has(name))) throw new Error("artifact members do not match the exact allowlist");
}

export async function extractCheckedTar({ archive, destination, artifactType, entries }) {
  const allowlist = ARTIFACTS[artifactType];
  if (!allowlist) throw new Error(`unknown artifact type: ${artifactType}`);
  if (entries) {
    const validated = validateEntries(entries, allowlist);
    requireExactMembers(validated, allowlist);
    for (const entry of validated) {
      const target = path.join(destination, entry.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.data ?? "");
    }
    return;
  }
  if ((await stat(archive)).size > MAX_ARCHIVE_BYTES) throw new Error("compressed artifact exceeds limit");
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
  const validated = validateEntries(listing.map((name) => ({ name })), allowlist);
  requireExactMembers(validated, allowlist);
  const verbose = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
  if (verbose.length !== validated.length || verbose.some((line) => !line.startsWith("-"))) throw new Error("unsupported tar member type");
  await mkdir(destination, { recursive: true });
  let expanded = 0;
  for (const { name } of validated) {
    let data;
    try { data = execFileSync("tar", ["-xOzf", archive, name], { maxBuffer: MAX_FILE_BYTES + 1 }); } catch (error) { throw new Error(`artifact file size exceeds limit: ${name}: ${error.message}`); }
    if (data.length > MAX_FILE_BYTES) throw new Error(`artifact file size exceeds limit: ${name}`);
    expanded += data.length;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("artifact expanded size exceeds limit");
    await writeFile(path.join(destination, name), data, { flag: "wx" });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  extractCheckedTar({ archive: process.argv[2], destination: process.argv[3], artifactType: process.argv[4] }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

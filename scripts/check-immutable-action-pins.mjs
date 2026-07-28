import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARDENED_FILES = new Set(["opencode-review/action.yml", ".github/workflows/opencode-review.yml"]);

async function discoverFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await discoverFiles(root, child));
    else if ((entry.name === "action.yml" || entry.name === "action.yaml") || (/^\.github\/workflows\//.test(child) && /\.ya?ml$/.test(entry.name))) files.push(child);
  }
  return files.sort();
}

function key(reference) {
  return `${reference.file}\0${reference.action}\0${reference.ref}`;
}

export async function checkActionPins(root, inventory) {
  if (inventory.some(({ file }) => HARDENED_FILES.has(file))) {
    throw new Error("Mutable action refs are forbidden in the hardened lane");
  }
  const allowed = new Set(inventory.map(key));
  const seenExceptions = new Set();
  const unapproved = [];
  for (const file of await discoverFiles(root)) {
    const content = await readFile(path.join(root, file), "utf8");
    for (const match of content.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)) {
      if (match[1].startsWith("./") || /^[0-9a-f]{40}$/.test(match[2])) continue;
      const reference = { file, action: match[1], ref: match[2] };
      const referenceKey = key(reference);
      if (HARDENED_FILES.has(file) || !allowed.has(referenceKey)) unapproved.push(reference);
      else seenExceptions.add(referenceKey);
    }
  }
  const stale = inventory.filter((reference) => !seenExceptions.has(key(reference)));
  if (stale.length) throw new Error(`Stale legacy action-pin exceptions: ${JSON.stringify(stale)}`);
  return { unapproved, exceptions: inventory };
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const inventory = JSON.parse(await readFile(path.join(root, "docs/legacy-action-pin-exceptions.json"), "utf8"));
  const result = await checkActionPins(root, inventory);
  if (result.unapproved.length) throw new Error(`Unapproved mutable action refs: ${JSON.stringify(result.unapproved)}`);
  process.stdout.write(`Immutable pins verified; ${result.exceptions.length} recorded legacy exceptions.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

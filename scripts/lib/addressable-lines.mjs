import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function parseAddressableLines(diff) {
  const result = {};
  let currentPath;
  let oldPath;
  let oldLine;
  let newLine;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- a/")) {
      oldPath = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice(6);
      if (!result[currentPath]) result[currentPath] = { LEFT: [], RIGHT: [] };
      continue;
    }
    if (line === "+++ /dev/null") {
      currentPath = oldPath;
      if (!result[currentPath]) result[currentPath] = { LEFT: [], RIGHT: [] };
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!currentPath || oldLine === undefined || newLine === undefined || line.startsWith("\\")) continue;
    if (line.startsWith("-")) {
      result[currentPath].LEFT.push(oldLine);
      oldLine += 1;
    } else if (line.startsWith("+")) {
      result[currentPath].RIGHT.push(newLine);
      newLine += 1;
    } else if (line.startsWith(" ")) {
      result[currentPath].LEFT.push(oldLine);
      result[currentPath].RIGHT.push(newLine);
      oldLine += 1;
      newLine += 1;
    }
  }
  for (const [filePath, sides] of Object.entries(result)) if (sides.LEFT.length === 0 && sides.RIGHT.length === 0) delete result[filePath];
  return result;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Usage: addressable-lines.mjs <diff> <output-json>");
  const result = parseAddressableLines(await readFile(inputPath, "utf8"));
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

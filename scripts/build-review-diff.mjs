import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function safePath(value) {
  return typeof value === "string" && value && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}

export async function buildReviewDiff({ workspace, headSha, statePath, selectedPathsPath, diffPath, changedPathsPath, exec = execFileSync }) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const selected = JSON.parse(await readFile(selectedPathsPath, "utf8"));
  if (!/^[0-9a-f]{40}$/.test(state.diff_base) || !/^[0-9a-f]{40}$/.test(headSha)) throw new Error("review diff identity is invalid");
  if (!Array.isArray(selected) || selected.some((item) => !safePath(item))) throw new Error("selected paths are invalid");
  const range = `${state.diff_base}..${headSha}`;
  const common = ["-C", workspace, "diff", "--diff-filter=ACDMRT", range, "--", ...selected];
  const diff = exec("git", ["-C", workspace, "diff", "--diff-filter=ACDMRT", "--find-renames", "--unified=80", range, "--", ...selected], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const names = exec("git", [...common.slice(0, 4), "--name-only", "-z", ...common.slice(4)], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }).split("\0").filter(Boolean);
  await writeFile(diffPath, diff);
  await writeFile(changedPathsPath, `${JSON.stringify(names, null, 2)}\n`);
  return names;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [workspace, headSha, statePath, selectedPathsPath, diffPath, changedPathsPath] = process.argv.slice(2);
  buildReviewDiff({ workspace, headSha, statePath, selectedPathsPath, diffPath, changedPathsPath }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReviewDiff } from "./build-review-diff.mjs";

test("builds the re-review diff from diff_base and selected paths including deletions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-diff-"));
  const statePath = path.join(root, "state.json");
  const selectedPath = path.join(root, "selected.json");
  const diffPath = path.join(root, "review.diff");
  const changedPath = path.join(root, "changed.json");
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  await writeFile(statePath, JSON.stringify({ diff_base: base }));
  await writeFile(selectedPath, JSON.stringify(["main.go", "deleted.go"]));
  const calls = [];
  const exec = (_command, args) => {
    calls.push(args);
    return args.includes("--name-only") ? "main.go\0deleted.go\0" : "diff --git a/main.go b/main.go\n";
  };
  assert.deepEqual(await buildReviewDiff({ workspace: root, headSha: head, statePath, selectedPathsPath: selectedPath, diffPath, changedPathsPath: changedPath, exec }), ["main.go", "deleted.go"]);
  assert.ok(calls.every((args) => args.includes(`${base}..${head}`) && args.includes("--diff-filter=ACDMRT")));
  assert.ok(calls.every((args) => args.slice(-2).join(",") === "main.go,deleted.go"));
  assert.match(await readFile(diffPath, "utf8"), /diff --git/);
});

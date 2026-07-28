import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractCheckedTar } from "./extract-checked-tar.mjs";
import { preparePublicationInputs } from "./prepare-publication-inputs.mjs";
import { sanitizeComment } from "./post-issue-comment.mjs";
import { validateToolkitSha, verifyOpenCodeVersion } from "./validate-runtime.mjs";

test("toolkit revision accepts only a full commit SHA", () => {
  assert.equal(validateToolkitSha("a".repeat(40)), "a".repeat(40));
  assert.throws(() => validateToolkitSha("main"), /40-character/);
  assert.throws(() => validateToolkitSha("a".repeat(39)), /40-character/);
});

test("OpenCode version verification fails closed on any mismatch", async () => {
  await verifyOpenCodeVersion("1.2.3", async () => "1.2.3\n");
  await assert.rejects(() => verifyOpenCodeVersion("1.2.3", async () => "1.2.4\n"), /expected 1.2.3/);
  await assert.rejects(() => verifyOpenCodeVersion("latest", async () => "latest\n"), /exact semantic version/);
});

test("checked extraction accepts regular relative files and rejects traversal and links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "checked-tar-"));
  const destination = path.join(root, "out");
  const complete = [{ name: "findings.json", type: "file", data: "{}" }, { name: "review-state.json", type: "file", data: "{}" }, { name: "changed-files.json", type: "file", data: "[]" }, { name: "addressable-lines.json", type: "file", data: "{}" }, { name: "serena-status.json", type: "file", data: "{}" }];
  await extractCheckedTar({ destination, artifactType: "analysis", entries: complete });
  assert.equal(await readFile(path.join(destination, "findings.json"), "utf8"), "{}");
  await assert.rejects(() => extractCheckedTar({ destination, artifactType: "analysis", entries: [{ name: "../escape", type: "file", data: "x" }] }), /unsafe tar member/);
  await assert.rejects(() => extractCheckedTar({ destination, artifactType: "analysis", entries: [{ name: "findings.json", type: "symlink", linkname: "../escape" }] }), /unsupported tar member/);
});

test("checked extraction enforces exact artifact allowlists, duplicate names, count, and expansion bounds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "checked-tar-bounds-"));
  const destination = path.join(root, "out");
  await extractCheckedTar({ destination, artifactType: "analysis", entries: [{ name: "findings.json", type: "file", data: "{}" }, { name: "review-state.json", type: "file", data: "{}" }, { name: "changed-files.json", type: "file", data: "[]" }, { name: "addressable-lines.json", type: "file", data: "{}" }, { name: "serena-status.json", type: "file", data: "{}" }] });
  await assert.rejects(() => extractCheckedTar({ destination, artifactType: "analysis", entries: [{ name: "findings.json", type: "file" }, { name: "findings.json", type: "file" }] }), /duplicate/);
  await assert.rejects(() => extractCheckedTar({ destination, artifactType: "analysis", entries: [{ name: "evil.json", type: "file" }] }), /allowlisted/);
  await assert.rejects(() => extractCheckedTar({ destination, artifactType: "analysis", entries: Array.from({ length: 101 }, (_, index) => ({ name: `file-${index}`, type: "file" })) }), /member count/);
  await assert.rejects(() => extractCheckedTar({ destination, artifactType: "analysis", entries: [{ name: "findings.json", type: "file", data: "x".repeat(2_100_000) }] }), /expanded|file size/);
});

test("publication inputs use toolkit finding IDs and preserve reconstructed threads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "publication-"));
  const findingsPath = path.join(root, "findings.json");
  const statePath = path.join(root, "review-state.json");
  await writeFile(findingsPath, JSON.stringify({ reviewed_head: "a".repeat(40), findings: [{ path: "Main.go", symbol: "Run", title: "Unsafe input", body: "Input reaches sink. More detail." }], serena: { schema_version: 1, status: "unavailable", revision: "b".repeat(40), reason: "setup_failed", warning: "Serena setup failed; review continued without Serena." } }));
  await writeFile(statePath, JSON.stringify({ known_threads: [{ thread_id: "T1", finding_id: "arf_old" }] }));
  const result = await preparePublicationInputs({ repository: "o/r", prNumber: 1, runId: "2", findingsPath, statePath });
  assert.deepEqual(result.publish.knownThreads, [{ thread_id: "T1", finding_id: "arf_old" }]);
  assert.equal(result.publish.serenaStatus, "unavailable");
  assert.equal(result.publish.serenaRevision, "b".repeat(40));
  assert.match(result.publish.serenaWarning, /continued without Serena/);
  assert.match(result.verify.findingIds[0], /^arf_[0-9a-f]{20}$/);
});

test("comment sanitizer strips controls, caps length, and rejects empty comments", () => {
  assert.equal(sanitizeComment("blocked\u0000 reason"), "blocked reason");
  assert.equal(sanitizeComment("x".repeat(70_000)).length, 65_536);
  assert.throws(() => sanitizeComment("\u0000\n"), /empty/);
});

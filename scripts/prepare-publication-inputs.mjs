import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { findingId } from "./lib/finding-id.mjs";

export async function preparePublicationInputs(options) {
  const findings = JSON.parse(await readFile(options.findingsPath, "utf8"));
  const state = JSON.parse(await readFile(options.statePath, "utf8"));
  const serena = findings.serena ?? { status: "disabled", revision: "0".repeat(40) };
  const common = { repository: options.repository, prNumber: Number(options.prNumber), runId: String(options.runId) };
  return {
    publish: { ...common, findingsPath: options.findingsPath, knownThreads: state.known_threads, validation: { reviewedHead: findings.reviewed_head, mode: state.mode, dimensions: options.dimensions, changedPaths: options.changedPaths, addressableLines: options.addressableLines, priorFindings: state.known_threads, knownThreadIds: state.known_thread_ids }, model: options.model, variant: options.variant, toolkitVersion: options.toolkitVersion, runUrl: options.runUrl, workflowPath: options.workflowPath, evidenceStatus: "READY", contextStatus: options.contextStatus, serenaStatus: serena.status, serenaWarning: serena.warning ?? null, serenaRevision: serena.revision },
    verify: { ...common, reviewedHead: findings.reviewed_head, findingIds: findings.findings.map((finding) => findingId({ ...finding, repository: options.repository })), runUrl: options.runUrl, workflowPath: options.workflowPath, toolkitSha: options.toolkitVersion },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = JSON.parse(await readFile(process.argv[2], "utf8"));
  const result = await preparePublicationInputs(options);
  await writeFile(process.argv[3], JSON.stringify(result.publish));
  await writeFile(process.argv[4], JSON.stringify(result.verify));
}

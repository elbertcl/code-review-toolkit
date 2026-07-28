import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { findingId } from "./lib/finding-id.mjs";
import { validateFindings } from "./run-review-analysis.mjs";

async function request(fetchImpl, url, token, method = "GET", body) {
  const response = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

function findingMarker(metadata) {
  return `<!-- astro-ai-finding:${JSON.stringify(metadata)} -->`;
}

async function currentHead(options) {
  return (await request(options.fetch, `https://api.github.com/repos/${options.repository}/pulls/${options.prNumber}`, options.token)).head.sha;
}

async function headIsCurrent(options) {
  return await currentHead(options) === options.findings.reviewed_head;
}

export async function publishReview(options) {
  validateFindings(options.findings, options.validation);
  const known = new Map(options.knownThreads.map((thread) => [thread.thread_id, thread.finding_id]));
  for (const item of options.findings.prior_thread_classifications) if (known.get(item.thread_id) !== item.finding_id) throw new Error(`unknown thread ID ${item.thread_id}`);
  const repositoryFindings = options.findings.findings.map((finding) => ({ ...finding, finding_id: findingId({ ...finding, repository: options.repository }) }));
  for (const item of options.findings.prior_thread_classifications.filter(({ outcome }) => outcome === "RESOLVED")) {
    if (!await headIsCurrent(options)) return { status: "stale", finding_ids: [] };
    await request(options.fetch, "https://api.github.com/graphql", options.token, "POST", { query: "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}", variables: { threadId: item.thread_id } });
  }
  if (!await headIsCurrent(options)) return { status: "stale", finding_ids: [] };
  if (repositoryFindings.length) {
    const comments = repositoryFindings.map((finding) => ({ path: finding.path, line: finding.line, side: finding.side, body: `[${finding.severity}] ${finding.title}\n\n${finding.body}\n\n**Suggested fix:** ${finding.suggested_fix}\n\n${findingMarker({ schema_version: 1, finding_id: finding.finding_id, run_id: options.runId, run_url: options.runUrl, workflow_path: options.workflowPath, dimension: finding.dimension, severity: finding.severity, reviewed_head: options.findings.reviewed_head, model: options.model, toolkit_sha: options.toolkitVersion })}` }));
    await request(options.fetch, `https://api.github.com/repos/${options.repository}/pulls/${options.prNumber}/reviews`, options.token, "POST", { commit_id: options.findings.reviewed_head, event: "COMMENT", body: "", comments });
  }
  if (!await headIsCurrent(options)) return { status: "stale", finding_ids: repositoryFindings.map(({ finding_id }) => finding_id) };
  const run = { schema_version: 1, run_id: options.runId, run_url: options.runUrl, workflow_path: options.workflowPath, reviewed_head: options.findings.reviewed_head, status: "COMPLETED", mode: options.findings.mode, evidence_status: options.evidenceStatus, context_status: options.contextStatus, serena_status: options.serenaStatus, serena_warning: options.serenaWarning ?? null, serena_revision: options.serenaRevision, provider: options.model?.split("/")[0], model: options.model, variant: options.variant, toolkit_sha: options.toolkitVersion, completed_at: options.now?.() ?? new Date().toISOString(), findings: repositoryFindings.map(({ finding_id }) => finding_id) };
  const serenaNotice = options.serenaWarning ? `\n\n> ${options.serenaWarning}` : "";
  const verdict = `## PR Verdict\n\nPublished ${repositoryFindings.length} finding(s).${serenaNotice}\n\n<!-- review-run-json\n${JSON.stringify(run)}\nreview-run-json -->\n<!-- reviewed-head: ${options.findings.reviewed_head} -->\n<!-- opencode-pr-review -->`;
  await request(options.fetch, `https://api.github.com/repos/${options.repository}/issues/${options.prNumber}/comments`, options.token, "POST", { body: verdict });
  return { status: "completed", finding_ids: run.findings };
}

async function main() {
  const options = JSON.parse(await readFile(process.argv[2], "utf8"));
  const findings = JSON.parse(await readFile(options.findingsPath, "utf8"));
  process.stdout.write(`${JSON.stringify(await publishReview({ ...options, token: options.token ?? process.env.GITHUB_TOKEN, findings, fetch: globalThis.fetch }))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

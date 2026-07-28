import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateReviewGate, formatGateComment, normalizeCheckRuns } from "./lib/review-gate.mjs";
import { globMatches, parseManifest, validateManifest } from "./lib/review-manifest.mjs";

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

export function authorizeRequester({ login, association, prAuthor }) {
  return login === prAuthor || TRUSTED_ASSOCIATIONS.has(association);
}

export async function findSizeOverride({ events, label, authorizedAssociations = [], getPermission }) {
  const matching = events
    .filter((event) => ["labeled", "unlabeled"].includes(event.event) && event.label?.name === label)
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const latest = matching.at(-1);
  if (!latest || latest.event !== "labeled") return { active: false, authorized: false };
  if (latest.actor?.type === "Bot" || !latest.actor?.login) return { active: true, authorized: false };
  if (authorizedAssociations.length && !authorizedAssociations.includes(latest.actor.association)) return { active: true, authorized: false };
  try {
    const permission = await getPermission(latest.actor.login);
    return { active: true, authorized: WRITE_PERMISSIONS.has(permission) };
  } catch (error) {
    if (error.status === 404) return { active: true, authorized: false };
    throw error;
  }
}

function nextLink(link) {
  if (!link) return null;
  return link.split(",").map((entry) => entry.trim()).find((entry) => /rel="next"/.test(entry))?.match(/^<([^>]+)>/)?.[1] ?? null;
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter)) return Math.min(retryAfter * 1000, 30_000);
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset)) return Math.min(Math.max(0, reset * 1000 - Date.now()), 30_000);
  return Math.min(1000 * 2 ** attempt, 8000);
}

export async function githubRequest(fetchImpl, url, token, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxRetries = 3, timeoutMs = 15_000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (response.ok) return response;
    const transient = response.status === 429 || response.status >= 500 || (response.status === 403 && (response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset")));
    if (!transient || attempt === maxRetries) {
      const error = new Error(`GitHub API ${response.status} for ${new URL(url).pathname}`);
      error.status = response.status;
      throw error;
    }
    await sleep(retryDelay(response, attempt));
  }
}

async function getJson(fetchImpl, url, token) {
  return (await githubRequest(fetchImpl, url, token)).json();
}

async function getPaginated(fetchImpl, url, token, extract = (value) => value) {
  const values = [];
  let next = url;
  for (let page = 0; next && page < 20; page += 1) {
    const response = await githubRequest(fetchImpl, next, token);
    values.push(...extract(await response.json()));
    next = nextLink(response.headers.get("link"));
  }
  return values;
}

async function writeResult({ workspace, result, pr, contextStatus, changedPaths = [] }) {
  const outputDir = path.join(workspace, ".opencode/tmp");
  await mkdir(outputDir, { recursive: true });
  const payload = {
    ...result,
    head_sha: pr.head.sha,
    base_sha: pr.base.sha,
    context_status: contextStatus,
  };
  await writeFile(path.join(outputDir, "changed-files.json"), `${JSON.stringify(changedPaths, null, 2)}\n`);
  await writeFile(path.join(outputDir, "review-gate.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(path.join(outputDir, "review-gate-comment.md"), `${formatGateComment(result)}\n`);
  return payload;
}

function expectedBlock(message) {
  return { proceed: false, blockers: [message] };
}

export async function runReviewGate({
  fetch: fetchImpl = globalThis.fetch,
  repository,
  prNumber,
  token,
  workspace,
  requester,
  readTrustedManifest,
  contextStatus = "READY",
}) {
  const api = `https://api.github.com/repos/${repository}`;
  const pr = await getJson(fetchImpl, `${api}/pulls/${prNumber}`, token);
  if (!authorizeRequester({ ...requester, prAuthor: pr.user.login })) return writeResult({ workspace, result: expectedBlock("Requester is not authorized to initiate this review"), pr, contextStatus });
  if (pr.draft) return writeResult({ workspace, result: expectedBlock("Draft pull requests are not reviewed"), pr, contextStatus });
  if (pr.head.repo.full_name !== pr.base.repo.full_name) return writeResult({ workspace, result: expectedBlock("Fork pull requests are not supported in V1"), pr, contextStatus });
  if (contextStatus === "BLOCKED") return writeResult({ workspace, result: expectedBlock("Required trusted review context is blocked"), pr, contextStatus });

  const manifest = await readTrustedManifest(pr.base.sha);
  const files = await getPaginated(fetchImpl, `${api}/pulls/${prNumber}/files?per_page=100`, token);
  const included = files.filter((file) => !manifest.excluded_paths.some((glob) => globMatches(glob, file.filename)));
  const changedPaths = included.map((file) => file.filename);
  if (changedPaths.length === 0) return writeResult({ workspace, result: expectedBlock("No reviewable files remain after exclusions"), pr, contextStatus, changedPaths });

  const checkRuns = await getPaginated(fetchImpl, `${api}/commits/${pr.head.sha}/check-runs?per_page=100`, token, (value) => value.check_runs);
  if (manifest.required_checks.some((check) => check.workflow_file || check.workflow_id)) {
    const suites = [...new Set(checkRuns.map((check) => check.check_suite?.id).filter(Boolean))];
    const workflowRuns = new Map();
    for (const suiteId of suites) {
      const payload = await getJson(fetchImpl, `${api}/actions/runs?check_suite_id=${suiteId}&per_page=100`, token);
      const run = payload.workflow_runs?.find((item) => item.check_suite_id === suiteId);
      if (run) workflowRuns.set(suiteId, { path: run.path, workflow_id: run.workflow_id });
    }
    for (const check of checkRuns) if (workflowRuns.has(check.check_suite?.id)) check.check_suite.workflow_run = workflowRuns.get(check.check_suite.id);
  }
  const statuses = await getPaginated(fetchImpl, `${api}/commits/${pr.head.sha}/statuses?per_page=100`, token);
  const events = await getPaginated(fetchImpl, `${api}/issues/${prNumber}/events?per_page=100`, token);
  const sizeOverride = await findSizeOverride({
    events,
    label: manifest.diff_override.label,
    authorizedAssociations: manifest.diff_override.authorized_associations,
    getPermission: async (login) => (await getJson(fetchImpl, `${api}/collaborators/${encodeURIComponent(login)}/permission`, token)).permission,
  });
  const result = evaluateReviewGate({
    body: pr.body ?? "",
    checks: normalizeCheckRuns(checkRuns, statuses),
    requiredChecks: manifest.required_checks,
    changedPaths,
    changedFiles: included.length,
    changedLines: included.reduce((total, file) => total + file.additions + file.deletions, 0),
    diffLimits: manifest.diff_limits,
    docsOnlyPaths: manifest.docs_only_paths,
    sizeOverride,
  });
  return writeResult({ workspace, result, pr, contextStatus, changedPaths });
}

function readAtRef(workspace, ref, filePath) {
  return execFileSync("git", ["-C", workspace, "show", `${ref}:${filePath}`], { encoding: "utf8" });
}

async function appendOutput(filePath, values) {
  if (!filePath) return;
  const text = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  await writeFile(filePath, `${text}\n`, { flag: "a" });
}

async function main() {
  const env = process.env;
  for (const name of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "PR_NUMBER", "REVIEW_WORKSPACE"]) if (!env[name]) throw new Error(`${name} is required`);
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")) : {};
  const result = await runReviewGate({
    repository: env.GITHUB_REPOSITORY,
    prNumber: Number(env.PR_NUMBER),
    token: env.GITHUB_TOKEN,
    workspace: env.REVIEW_WORKSPACE,
    requester: {
      login: env.REQUESTER_LOGIN ?? event.comment?.user?.login,
      association: env.REQUESTER_ASSOCIATION ?? event.comment?.author_association,
    },
    contextStatus: env.CONTEXT_STATUS ?? "READY",
    readTrustedManifest: async (baseSha) => validateManifest(parseManifest(readAtRef(env.REVIEW_WORKSPACE, baseSha, "REVIEW.md"))),
  });
  await appendOutput(env.GITHUB_OUTPUT, {
    proceed: result.proceed,
    head_sha: result.head_sha,
    base_sha: result.base_sha,
    context_status: result.context_status,
  });
  if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, `${formatGateComment(result)}\n`, { flag: "a" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Review gate failed unexpectedly: ${error.message}\n`);
    process.exitCode = 1;
  });
}

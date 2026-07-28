import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REVIEWER = "github-actions[bot]";

function markers(comments) {
  return comments.filter(({ user }) => user?.login === REVIEWER).flatMap(({ body }) => [...String(body ?? "").matchAll(/<!-- astro-ai-finding:(\{[^\n]*\}) -->/g)].flatMap((match) => { try { return [JSON.parse(match[1])]; } catch { return []; } }));
}

function provenanceMatches(value, expected) {
  return value.run_id === expected.runId && value.reviewed_head === expected.reviewedHead && value.workflow_path === expected.workflowPath && value.run_url === expected.runUrl && value.toolkit_sha === expected.toolkitSha;
}

export function verifyPublication({ runId, reviewedHead, findingIds, workflowPath, runUrl, toolkitSha, inlineComments, issueComments }) {
  const expected = { runId, reviewedHead, workflowPath, runUrl, toolkitSha };
  const published = new Set(markers(inlineComments).filter((marker) => provenanceMatches(marker, expected)).map((marker) => marker.finding_id));
  const missing = findingIds.filter((id) => !published.has(id));
  const completed = issueComments.filter(({ user }) => user?.login === REVIEWER).some(({ body }) => {
    const text = String(body ?? "");
    if (!text.includes(`<!-- reviewed-head: ${reviewedHead} -->`) || !text.includes("<!-- opencode-pr-review -->")) return false;
    return [...text.matchAll(/<!-- review-run-json\n(\{[^]*?\})\nreview-run-json -->/g)].some((match) => { try { const run = JSON.parse(match[1]); return provenanceMatches(run, expected) && run.status === "COMPLETED"; } catch { return false; } });
  });
  return { complete: missing.length === 0 && completed, missing };
}

function nextLink(link) {
  return link?.split(",").map((part) => part.trim()).find((part) => /rel="next"/.test(part))?.match(/^<([^>]+)>/)?.[1] ?? null;
}

async function paginate(fetchImpl, url, token) {
  const values = [];
  for (let next = url; next;) {
    const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    values.push(...await response.json());
    next = nextLink(response.headers.get("link"));
  }
  return values;
}

export async function fetchAndVerifyPublication({ fetch = globalThis.fetch, token, repository, prNumber, ...expected }) {
  const root = `https://api.github.com/repos/${repository}`;
  const [inlineComments, issueComments, runResponse] = await Promise.all([
    paginate(fetch, `${root}/pulls/${prNumber}/comments?per_page=100`, token),
    paginate(fetch, `${root}/issues/${prNumber}/comments?per_page=100`, token),
    fetch(`${root}/actions/runs/${expected.runId}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }),
  ]);
  if (!runResponse.ok) throw new Error(`GitHub API ${runResponse.status}`);
  const run = await runResponse.json();
  const currentRun = run.status === "in_progress" && run.conclusion === null;
  const successfulRun = run.status === "completed" && run.conclusion === "success";
  const trustedRun = String(run.id) === String(expected.runId) && run.path === expected.workflowPath && run.html_url === expected.runUrl && (currentRun || successfulRun);
  const result = verifyPublication({ ...expected, inlineComments, issueComments });
  return trustedRun ? result : { ...result, complete: false };
}

async function main() {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  const result = input.repository
    ? await fetchAndVerifyPublication({ ...input, token: input.token ?? process.env.GITHUB_TOKEN })
    : verifyPublication(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.complete) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

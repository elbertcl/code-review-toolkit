import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function sanitizeComment(value) {
  const sanitized = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 65_536);
  if (!sanitized.trim()) throw new Error("comment is empty after sanitization");
  return sanitized;
}

export async function postIssueComment({ fetch = globalThis.fetch, token, repository, prNumber, body }) {
  const response = await fetch(`https://api.github.com/repos/${repository}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ body: sanitizeComment(body) }),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const body = process.argv[2] === "--file" ? await readFile(process.argv[3], "utf8") : process.argv[2];
  postIssueComment({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, prNumber: process.env.PR_NUMBER, body })
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

import { fileURLToPath } from "node:url";

export async function checkApprovalPolicy(fetchSettings, organization = process.env.GITHUB_ORGANIZATION) {
  const response = await fetchSettings(organization);
  if (!response.ok) throw new Error(`Actions approval policy API failed with ${response.status}: ${await response.text()}`);
  const settings = await response.json();
  if (settings.can_approve_pull_request_reviews !== false) {
    throw new Error("can_approve_pull_request_reviews must be explicitly false");
  }
  return { compliant: true };
}

async function main() {
  const organization = process.env.GITHUB_ORGANIZATION;
  const token = process.env.GITHUB_TOKEN;
  if (!organization || !token) throw new Error("GITHUB_ORGANIZATION and GITHUB_TOKEN are required");
  const url = `https://api.github.com/orgs/${encodeURIComponent(organization)}/actions/permissions/workflow`;
  const result = await checkApprovalPolicy(() => fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }), organization);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

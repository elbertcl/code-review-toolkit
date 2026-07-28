import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { fetchReviewState, reconstructReviewState } from "./lib/review-state.mjs";

export async function prepareReviewState({ headSha, mergeBaseSha, fetchState, isAncestor }) {
  const fetched = await fetchState();
  const ancestor = isAncestor ?? ((candidate, descendant) => descendant === headSha && fetched.commits.some((commit) => commit.sha === candidate));
  return reconstructReviewState({ headSha, mergeBaseSha, ...fetched, isAncestor: ancestor });
}

async function graphqlRequest({ cursor }) {
  const [owner, name] = process.env.GITHUB_REPOSITORY.split("/");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ query: "query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id comments(first:1){nodes{databaseId author{login}}}} pageInfo{hasNextPage endCursor}}}}}", variables: { owner, name, number: Number(process.env.PR_NUMBER), cursor } }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL API ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`GitHub GraphQL error: ${payload.errors[0].message}`);
  return payload.data.repository.pullRequest.reviewThreads;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [headSha, mergeBaseSha, , outputPath] = process.argv.slice(2);
  const state = await prepareReviewState({
    headSha,
    mergeBaseSha,
    fetchState: () => fetchReviewState({ fetch, graphql: graphqlRequest, apiBase: process.env.GITHUB_API_URL, repository: process.env.GITHUB_REPOSITORY, prNumber: Number(process.env.PR_NUMBER), token: process.env.GITHUB_TOKEN }),
    isAncestor: undefined,
  });
  await writeFile(outputPath, `${JSON.stringify(state, null, 2)}\n`);
}

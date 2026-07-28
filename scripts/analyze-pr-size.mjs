#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SEARCH_CAP = 900;
const GRAPHQL_QUERY = `
  query($queryString: String!, $endCursor: String) {
    search(query: $queryString, type: ISSUE, first: 100, after: $endCursor) {
      issueCount
      nodes {
        ... on PullRequest {
          id
          changedFiles
          additions
          deletions
          author { login }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export function percentile(values, ratio) {
  if (values.length === 0) return 0;
  if (ratio <= 0 || ratio > 1) {
    throw new RangeError('ratio must be greater than 0 and at most 1');
  }

  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(ratio * sorted.length) - 1];
}

function distribution(values) {
  return {
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

export function summarizePullRequests(pullRequests) {
  const humanPullRequests = pullRequests.filter(
    (pullRequest) => !pullRequest.author?.login?.endsWith('[bot]'),
  );

  return {
    sampleSize: humanPullRequests.length,
    changedFiles: distribution(humanPullRequests.map(({ changedFiles }) => changedFiles)),
    changedLines: distribution(
      humanPullRequests.map(({ additions, deletions }) => additions + deletions),
    ),
  };
}

function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateInputs(repository, startDate, endDate) {
  const resolvedEndDate = endDate ?? new Date().toISOString().slice(0, 10);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('repository must use owner/repo format');
  }
  if (!isISODate(startDate) || !isISODate(resolvedEndDate)) {
    throw new Error('dates must use valid YYYY-MM-DD format');
  }
  if (startDate > resolvedEndDate) {
    throw new Error('start date must be on or before end date');
  }

  return { repository, startDate, endDate: resolvedEndDate };
}

export function splitIntoCalendarMonths(startDate, endDate) {
  const ranges = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const finalDate = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= finalDate) {
    const monthStart = cursor.toISOString().slice(0, 10);
    const monthEndDate = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const rangeEnd = monthEndDate < finalDate ? monthEndDate : finalDate;
    ranges.push({ startDate: monthStart, endDate: rangeEnd.toISOString().slice(0, 10) });
    cursor = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate() + 1));
  }

  return ranges;
}

export function dedupePullRequests(pullRequests) {
  const byID = new Map();
  for (const pullRequest of pullRequests) {
    if (!byID.has(pullRequest.id)) byID.set(pullRequest.id, pullRequest);
  }
  return [...byID.values()];
}

export function fetchPullRequests(
  repository,
  startDate,
  endDate,
  execFile = execFileSync,
) {
  const queryString = `repo:${repository} is:pr created:${startDate}..${endDate}`;
  const output = execFile('gh', [
    'api',
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `query=${GRAPHQL_QUERY}`,
    '-f',
    `queryString=${queryString}`,
  ], { encoding: 'utf8' });
  const pages = JSON.parse(output);

  return {
    issueCount: pages[0]?.data?.search?.issueCount ?? 0,
    pullRequests: pages.flatMap((page) => page.data?.search?.nodes ?? []),
  };
}

export function collectPullRequests(repository, startDate, endDate, fetch = fetchPullRequests) {
  const initial = fetch(repository, startDate, endDate);
  if (initial.issueCount <= SEARCH_CAP) return dedupePullRequests(initial.pullRequests);

  const pullRequests = [];
  for (const range of splitIntoCalendarMonths(startDate, endDate)) {
    const result = fetch(repository, range.startDate, range.endDate);
    if (result.issueCount > SEARCH_CAP) {
      throw new Error(
        `GitHub search cap exceeded for ${range.startDate}..${range.endDate}; use a shorter date range`,
      );
    }
    pullRequests.push(...result.pullRequests);
  }
  return dedupePullRequests(pullRequests);
}

export function main(args = process.argv.slice(2)) {
  if (args.length < 2 || args.length > 3) {
    throw new Error('usage: analyze-pr-size.mjs <owner/repo> <start YYYY-MM-DD> [end YYYY-MM-DD]');
  }
  const { repository, startDate, endDate } = validateInputs(...args);
  const pullRequests = collectPullRequests(repository, startDate, endDate);
  process.stdout.write(`${JSON.stringify(summarizePullRequests(pullRequests), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

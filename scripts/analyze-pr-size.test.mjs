import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectPullRequests,
  dedupePullRequests,
  fetchPullRequests,
  percentile,
  splitIntoCalendarMonths,
  summarizePullRequests,
  validateInputs,
} from './analyze-pr-size.mjs';

test('percentile uses a ratio with the nearest-rank method', () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 0.9), 100);
  assert.equal(percentile([10], 0.95), 10);
});

test('summarizePullRequests excludes bot logins and reports both size dimensions', () => {
  const result = summarizePullRequests([
    { author: { login: 'human' }, changedFiles: 2, additions: 10, deletions: 5 },
    { author: { login: 'dependabot[bot]' }, changedFiles: 99, additions: 999, deletions: 1 },
    { author: null, changedFiles: 6, additions: 20, deletions: 10 },
  ]);

  assert.deepEqual(result, {
    sampleSize: 2,
    changedFiles: { p50: 2, p90: 6, p95: 6, max: 6 },
    changedLines: { p50: 15, p90: 30, p95: 30, max: 30 },
  });
});

test('summarizePullRequests returns zeroes for empty distributions', () => {
  assert.deepEqual(summarizePullRequests([]), {
    sampleSize: 0,
    changedFiles: { p50: 0, p90: 0, p95: 0, max: 0 },
    changedLines: { p50: 0, p90: 0, p95: 0, max: 0 },
  });
});

test('fetchPullRequests flattens two slurped GraphQL pages and passes arguments without a shell', () => {
  const calls = [];
  const execFile = (file, args, options) => {
    calls.push({ file, args, options });
    return JSON.stringify([
      { data: { search: { issueCount: 2, nodes: [{ id: 'PR_1' }] } } },
      { data: { search: { issueCount: 2, nodes: [{ id: 'PR_2' }] } } },
    ]);
  };

  const result = fetchPullRequests('owner/repo', '2026-01-01', '2026-01-31', execFile);

  assert.deepEqual(result, { issueCount: 2, pullRequests: [{ id: 'PR_1' }, { id: 'PR_2' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 4), ['api', 'graphql', '--paginate', '--slurp']);
  assert.ok(calls[0].args.includes('queryString=repo:owner/repo is:pr created:2026-01-01..2026-01-31'));
  assert.deepEqual(calls[0].options, { encoding: 'utf8' });
});

test('validateInputs accepts an owner/repo and ordered ISO dates', () => {
  assert.deepEqual(validateInputs('astronautsid/astro-ads-be', '2026-01-01', '2026-01-31'), {
    repository: 'astronautsid/astro-ads-be',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });
});

test('validateInputs defaults the optional end date to the current UTC date', () => {
  assert.deepEqual(validateInputs('astronautsid/astro-ads-be', '2026-01-01'), {
    repository: 'astronautsid/astro-ads-be',
    startDate: '2026-01-01',
    endDate: new Date().toISOString().slice(0, 10),
  });
});

test('validateInputs rejects malformed repositories and invalid or reversed dates', () => {
  assert.throws(() => validateInputs('owner', '2026-01-01', '2026-01-31'), /owner\/repo/);
  assert.throws(() => validateInputs('owner/repo', '2026-02-30', '2026-03-01'), /YYYY-MM-DD/);
  assert.throws(() => validateInputs('owner/repo', '2026-03-02', '2026-03-01'), /on or before/);
});

test('splitIntoCalendarMonths clips ranges to calendar-month boundaries', () => {
  assert.deepEqual(splitIntoCalendarMonths('2025-12-15', '2026-03-10'), [
    { startDate: '2025-12-15', endDate: '2025-12-31' },
    { startDate: '2026-01-01', endDate: '2026-01-31' },
    { startDate: '2026-02-01', endDate: '2026-02-28' },
    { startDate: '2026-03-01', endDate: '2026-03-10' },
  ]);
});

test('dedupePullRequests keeps one pull request per node ID', () => {
  assert.deepEqual(dedupePullRequests([
    { id: 'PR_1', changedFiles: 1 },
    { id: 'PR_2', changedFiles: 2 },
    { id: 'PR_1', changedFiles: 3 },
  ]), [
    { id: 'PR_1', changedFiles: 1 },
    { id: 'PR_2', changedFiles: 2 },
  ]);
});

test('collectPullRequests splits capped searches by month and deduplicates IDs', () => {
  const ranges = [];
  const fetch = (_repository, startDate, endDate) => {
    ranges.push({ startDate, endDate });
    if (startDate === '2026-01-15' && endDate === '2026-02-10') {
      return { issueCount: 901, pullRequests: [] };
    }
    if (startDate === '2026-01-15') {
      return { issueCount: 1, pullRequests: [{ id: 'PR_1' }] };
    }
    return { issueCount: 2, pullRequests: [{ id: 'PR_1' }, { id: 'PR_2' }] };
  };

  assert.deepEqual(
    collectPullRequests('owner/repo', '2026-01-15', '2026-02-10', fetch),
    [{ id: 'PR_1' }, { id: 'PR_2' }],
  );
  assert.deepEqual(ranges, [
    { startDate: '2026-01-15', endDate: '2026-02-10' },
    { startDate: '2026-01-15', endDate: '2026-01-31' },
    { startDate: '2026-02-01', endDate: '2026-02-10' },
  ]);
});

test('collectPullRequests rejects a calendar month that still exceeds the search cap', () => {
  const fetch = () => ({ issueCount: 901, pullRequests: [] });

  assert.throws(
    () => collectPullRequests('owner/repo', '2026-01-01', '2026-01-31', fetch),
    /use a shorter date range/,
  );
});

test('CLI rejects invalid input before invoking gh', () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./analyze-pr-size.mjs', import.meta.url)),
    'not-a-repository',
    '2026-01-01',
    '2026-01-31',
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner\/repo/);
});

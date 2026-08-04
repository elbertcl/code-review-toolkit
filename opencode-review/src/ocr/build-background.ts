import { readFileSync } from "node:fs";

interface Thread {
  path: string;
  line: number;
  is_resolved: boolean;
  is_outdated: boolean;
  comment_count: number;
  human_bodies: string[];
  latest_author?: string;
  latest_body_excerpt?: string;
}

export function allocateBudget(threads: { human_bodies: string[] }[], cap: number): number[] {
  if (threads.length === 0) return [];
  const perThread = Math.floor(cap / threads.length);
  return threads.map(() => perThread);
}

function formatDigest(thread: Thread, budget: number): string {
  const header = `- ${thread.path}:${thread.line} (resolved, ${thread.comment_count} comment${thread.comment_count !== 1 ? "s" : ""}):`;
  const combined = thread.human_bodies.join(" ");
  const available = Math.max(0, budget);
  if (available === 0) return `${header} …[truncated]`;
  if (Buffer.byteLength(combined) <= available) return `${header} ${combined}`;
  let truncated = "";
  let bytes = 0;
  for (const char of combined) {
    const charBytes = Buffer.byteLength(char);
    if (bytes + charBytes > available - 14) break;
    truncated += char;
    bytes += charBytes;
  }
  return `${header} ${truncated}…[truncated]`;
}

export function buildBackground(threads: Thread[] | null | undefined): string {
  if (!Array.isArray(threads) || threads.length === 0) {
    return "No prior review threads on this PR.";
  }

  const directive =
    "The following reviewer threads are already open on this PR. Do NOT re-flag " +
    "a finding whose (path, line) is listed here unless the diff introduces a new, " +
    "distinct issue at that anchor. Prefer replying to the existing thread over " +
    "opening a duplicate.";

  const TOTAL_BUDGET = 8192;
  const NEWLINE = 1;

  const resolved = threads.filter((t) => t.is_resolved && !t.is_outdated);
  const unresolved = threads.filter((t) => !t.is_resolved && !t.is_outdated);

  const unresolvedLines = unresolved.map((t) => `- ${t.path}:${t.line} (unresolved)`);
  const resolvedHeaders = resolved.map((t) =>
    `- ${t.path}:${t.line} (resolved, ${t.comment_count} comment${t.comment_count !== 1 ? "s" : ""}):`
  );

  const fixedBytes = Buffer.byteLength(
    directive + "\n\n" + unresolvedLines.join("\n")
  );
  const resolvedOverhead = resolvedHeaders.reduce((sum, h) => sum + Buffer.byteLength(h) + 1, 0);
  const newlineOverhead = resolved.length > 0 ? (unresolved.length > 0 ? resolved.length : resolved.length - 1) * NEWLINE : 0;
  const available = TOTAL_BUDGET - fixedBytes - resolvedOverhead - newlineOverhead;
  const budgetForContent = Math.max(0, available);

  const allocations = allocateBudget(resolved, budgetForContent);
  const digestLines = resolved.map((t, i) => formatDigest(t, allocations[i]));

  const allLines = [...unresolvedLines, ...digestLines];
  return `${directive}\n\n${allLines.join("\n")}`;
}

if (process.argv[1] && process.argv[1].endsWith("build-background.js")) {
  const threadsPath = process.argv[2];
  const threads = threadsPath ? JSON.parse(readFileSync(threadsPath, "utf8")) as Thread[] : [];
  process.stdout.write(buildBackground(threads) + "\n");
}
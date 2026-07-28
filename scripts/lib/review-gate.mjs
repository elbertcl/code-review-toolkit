import { globMatches } from "./review-manifest.mjs";

const EVIDENCE_SECTIONS = [
  ["purpose", "Purpose"],
  ["approachAndTradeoffs", "Approach And Tradeoffs"],
  ["commands", "Commands"],
  ["result", "Result"],
  ["noTestException", "No-Test Exception"],
];

function sectionPattern(heading) {
  return new RegExp(`^### ${heading}\\s*\\n([\\s\\S]*?)(?=^### |^## |\\s*$)`, "gm");
}

export function parseEvidence(body) {
  if (typeof body !== "string") throw new Error("PR body must be text");
  for (const heading of ["Review Decision", "Verification Evidence"]) {
    const matches = body.match(new RegExp(`^## ${heading}\\s*$`, "gm")) ?? [];
    if (matches.length !== 1) throw new Error(`Evidence heading ${heading} must appear exactly once`);
  }
  const evidence = {};
  for (const [key, heading] of EVIDENCE_SECTIONS) {
    const matches = [...body.matchAll(sectionPattern(heading))];
    if (matches.length !== 1) throw new Error(`Evidence heading ${heading} must appear exactly once`);
    evidence[key] = matches[0][1].trim();
  }
  return evidence;
}

function normalizedState(status, conclusion) {
  if (status !== "completed") return "pending";
  return conclusion ?? "pending";
}

export function normalizeCheckRuns(checkRuns = [], statuses = []) {
  const latestChecks = new Map();
  for (const check of checkRuns) {
    const checkKey = `${check.name}\0${check.app?.slug ?? ""}`;
    const current = latestChecks.get(checkKey);
    const checkOrder = [check.completed_at ?? check.started_at ?? check.created_at ?? "", Number(check.id ?? 0)];
    const currentOrder = [current?.completed_at ?? current?.started_at ?? current?.created_at ?? "", Number(current?.id ?? 0)];
    if (!current || checkOrder[0] > currentOrder[0] || (checkOrder[0] === currentOrder[0] && checkOrder[1] > currentOrder[1])) latestChecks.set(checkKey, check);
  }
  const normalized = [...latestChecks.values()].map((check) => ({
    name: check.name,
    appSlug: check.app?.slug ?? null,
    ...(check.check_suite?.workflow_run?.path ? { workflowFile: check.check_suite.workflow_run.path } : {}),
    ...(check.check_suite?.workflow_run?.workflow_id ? { workflowId: check.check_suite.workflow_run.workflow_id } : {}),
    state: normalizedState(check.status, check.conclusion),
  }));
  const latestStatuses = new Map();
  for (const status of statuses) {
    const current = latestStatuses.get(status.context);
    if (!current || String(status.updated_at) > String(current.updated_at)) latestStatuses.set(status.context, status);
  }
  for (const status of latestStatuses.values()) {
    normalized.push({ name: status.context, appSlug: null, state: String(status.state).toLowerCase() });
  }
  return normalized;
}

function invalidEvidence(value) {
  const text = value.trim();
  if (!text || /^(?:describe|summarize)(?:\b|$)/i.test(text)) return true;
  const meaningful = text.split("\n").filter((line) => line.trim() && !/^\s*- \[ \]/.test(line));
  return meaningful.length === 0;
}

function checkApplies(check, changedPaths) {
  return !check.when_changed || changedPaths.some((changedPath) => check.when_changed.some((glob) => globMatches(glob, changedPath)));
}

function checkPassed(check, actual) {
  if (actual.state === "success") return true;
  return check.allow_skipped === true && (actual.state === "neutral" || actual.state === "skipped");
}

export function evaluateReviewGate(input) {
  const blockers = [];
  let evidence;
  try {
    evidence = parseEvidence(input.body);
  } catch (error) {
    return { proceed: false, blockers: [error.message] };
  }
  for (const [key, heading] of EVIDENCE_SECTIONS.slice(0, 4)) {
    if ((key === "purpose" || key === "approachAndTradeoffs") && invalidEvidence(evidence[key])) blockers.push(`${heading} evidence is incomplete`);
    else if (evidence[key] && /not applicable/i.test(evidence[key])) blockers.push(`${heading} evidence is incomplete`);
  }

  const changedPaths = input.changedPaths ?? [];
  const docsOnly = changedPaths.length > 0 && changedPaths.every((changedPath) => (input.docsOnlyPaths ?? []).some((glob) => globMatches(glob, changedPath)));
  const hasException = evidence.noTestException.replace(/\s/g, "").length >= 20 && !/not applicable/i.test(evidence.noTestException);
  const exceptionRequested = !evidence.commands && !evidence.result && hasException;
  if (evidence.commands && invalidEvidence(evidence.commands)) blockers.push("Commands evidence is incomplete");
  if (evidence.result && invalidEvidence(evidence.result)) blockers.push("Result evidence is incomplete");
  if ((!evidence.commands || !evidence.result) && !exceptionRequested) blockers.push("Commands and Result are required unless a valid no-test exception applies");
  if (exceptionRequested && !docsOnly) blockers.push("No-test exception is limited to documentation-only changes");

  for (const required of (input.requiredChecks ?? []).filter((check) => checkApplies(check, changedPaths))) {
    if (exceptionRequested && docsOnly && required.category === "test") continue;
    const actual = (input.checks ?? []).find((check) => check.name === required.name
      && (!required.app_slug || check.appSlug === required.app_slug)
      && (!required.workflow_file || check.workflowFile === required.workflow_file)
      && (!required.workflow_id || check.workflowId === required.workflow_id));
    if (!actual) blockers.push(`Missing required check: ${required.name}`);
    else if (!checkPassed(required, actual)) blockers.push(`Required check ${required.name} is ${actual.state}`);
  }

  const oversized = input.changedFiles > input.diffLimits.changed_files || input.changedLines > input.diffLimits.changed_lines;
  if (oversized && !(input.sizeOverride?.active && input.sizeOverride?.authorized)) blockers.push("Diff exceeds configured review limits without an authorized override");
  return { proceed: blockers.length === 0, blockers };
}

export function formatGateComment(result) {
  if (result.proceed) return "**OpenCode review preflight passed.**";
  return `**OpenCode review blocked.**\n\n${result.blockers.map((blocker) => `- ${blocker}`).join("\n")}`;
}

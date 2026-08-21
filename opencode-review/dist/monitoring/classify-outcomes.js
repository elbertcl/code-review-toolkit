import { readFileSync, writeFileSync } from "node:fs";
import { computeObservedPrecision, computeEstimatedRecall, } from "./precision-recall.js";
import { pushToDatadog } from "./push-datadog.js";
const SEVERITY_RE = /^\*\*\[(CRITICAL|HIGH|MEDIUM|LOW)/i;
const ANCHOR_WINDOW = 5;
const isBot = (c) => (c.author?.login ?? "").endsWith("[bot]");
export function classifyThreads(threads) {
    const botAnchors = [];
    const classifications = [];
    const severityOutcome = {};
    let accepted = 0, disputed = 0, deferred = 0, resolvedCount = 0;
    const responseHours = [];
    let matchedHuman = 0, unmatchedHuman = 0;
    for (const thread of threads) {
        const nodes = thread.comments.nodes;
        const first = nodes[0];
        if (!first)
            continue;
        const line = first.line ?? 0;
        if (isBot(first) && SEVERITY_RE.test(first.body)) {
            botAnchors.push({ path: first.path, line });
            const severity = (first.body.match(SEVERITY_RE)?.[1] ?? "INFO").toUpperCase();
            const humanReplies = nodes.filter((c) => !isBot(c));
            if (humanReplies.length > 0 && humanReplies[0].createdAt && first.createdAt) {
                const h = (Date.parse(humanReplies[0].createdAt) - Date.parse(first.createdAt)) / 3_600_000;
                if (Number.isFinite(h) && h >= 0)
                    responseHours.push(h);
            }
            let outcome;
            if (thread.isResolved) {
                outcome = "accepted";
                accepted++;
                resolvedCount++;
            }
            else if (humanReplies.length > 0) {
                outcome = "disputed";
                disputed++;
            }
            else {
                outcome = "deferred";
                deferred++;
            }
            classifications.push({
                outcome,
                finding_id: `${first.path}:${line}`,
                classification_reason: `thread ${thread.isResolved ? "resolved" : humanReplies.length > 0 ? "disputed by reply" : "unaddressed"} at close`,
                confidence: "high",
            });
            severityOutcome[severity] ??= { accepted: 0, disputed: 0, deferred: 0 };
            severityOutcome[severity][outcome]++;
        }
        else if (!isBot(first)) {
            const nearBot = botAnchors.some((a) => a.path === first.path && Math.abs(a.line - line) <= ANCHOR_WINDOW);
            if (nearBot)
                matchedHuman++;
            else
                unmatchedHuman++;
        }
    }
    return {
        botFindings: accepted + disputed + deferred,
        accepted, disputed, deferred,
        precision: computeObservedPrecision(classifications),
        recall: computeEstimatedRecall(matchedHuman, unmatchedHuman),
        matchedHuman, unmatchedHuman,
        threadResolveRate: botAnchors.length > 0 ? resolvedCount / botAnchors.length : null,
        avgFirstResponseHours: responseHours.length > 0
            ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length
            : null,
        severityOutcome,
    };
}
export function buildOutcomeSeries(s, tags, ts) {
    const points = [];
    if (s.precision != null)
        points.push(["effectiveness.precision_observed", s.precision, []]);
    if (s.recall != null)
        points.push(["effectiveness.recall_estimated", s.recall, []]);
    if (s.threadResolveRate != null)
        points.push(["engagement.thread_resolve_rate", s.threadResolveRate, []]);
    if (s.avgFirstResponseHours != null)
        points.push(["engagement.avg_first_response_hours", s.avgFirstResponseHours, []]);
    points.push(["engagement.unmatched_human_findings", s.unmatchedHuman, []]);
    for (const [severity, outcomes] of Object.entries(s.severityOutcome)) {
        for (const [outcome, count] of Object.entries(outcomes)) {
            if (count > 0)
                points.push(["effectiveness.findings", count, [`severity:${severity}`, `outcome:${outcome}`]]);
        }
    }
    return points.map(([name, value, extra]) => ({
        metric: `code_review_toolkit.${name}`,
        points: [[ts, value]],
        type: "gauge",
        tags: [...tags, ...extra],
    }));
}
export function recoverModelFromVerdicts(comments, verdictMarker) {
    const verdicts = comments
        .filter((c) => (c.body || "").includes(verdictMarker))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const latest = verdicts[0];
    if (!latest)
        return { model: null, verdictAt: null };
    const model = latest.body.match(/- Model: (\S+)/)?.[1] ?? null;
    return { model, verdictAt: latest.created_at };
}
if (process.argv[1] && process.argv[1].endsWith("classify-outcomes.js")) {
    const [threadsPath, commentsPath, prArg] = process.argv.slice(2);
    if (!threadsPath || !commentsPath || !prArg) {
        process.stderr.write("Usage: node classify-outcomes.js <threads.json> <comments.json> <pr_number>\n");
        process.exit(1);
    }
    const threads = JSON.parse(readFileSync(threadsPath, "utf8"));
    const comments = JSON.parse(readFileSync(commentsPath, "utf8"));
    const summary = classifyThreads(threads);
    if (summary.botFindings === 0) {
        process.stdout.write("outcomes: no bot findings — nothing to push\n");
        process.exit(0);
    }
    const tags = [];
    if (process.env.GITHUB_REPOSITORY)
        tags.push(`repo:${process.env.GITHUB_REPOSITORY}`);
    const { model, verdictAt } = recoverModelFromVerdicts(comments, "<!-- opencode-pr-review -->");
    if (model)
        tags.push(`model:${model}`);
    if (verdictAt) {
        const lagH = Math.round((Date.now() - Date.parse(verdictAt)) / 3_600_000);
        if (Number.isFinite(lagH) && lagH >= 0)
            tags.push(`outcome_lag_h:${lagH}`);
    }
    writeFileSync("/tmp/outcome-summary.json", JSON.stringify({ summary, tags }, null, 2) + "\n");
    const apiKey = process.env.DD_API_KEY || "";
    if (!apiKey) {
        process.stdout.write("outcomes: DD_API_KEY not set — wrote /tmp/outcome-summary.json only\n");
        process.exit(0);
    }
    const series = buildOutcomeSeries(summary, tags, Math.floor(Date.now() / 1000));
    pushToDatadog(apiKey, process.env.DD_SITE || "datadoghq.com", series)
        .then((r) => {
        process.stdout.write(r.ok ? "outcomes: pushed\n" : `outcomes: push failed (${r.error})\n`);
        process.exit(0);
    })
        .catch((e) => {
        process.stdout.write(`outcomes: push error (${e.message})\n`);
        process.exit(0);
    });
}
//# sourceMappingURL=classify-outcomes.js.map
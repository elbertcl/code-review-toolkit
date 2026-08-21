import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchFindings, evaluateCell, ExpectedFinding, ActualFinding } from "./evaluate.js";

const exp: ExpectedFinding[] = [
  { path: "a.go", line_approx: 40, severity: "CRITICAL", rule_id: "RULE-TRK-02" },
  { path: "b.go", line_approx: 10, severity: "HIGH" },
];
const act: ActualFinding[] = [
  { path: "a.go", line: 44, severity: "CRITICAL", body: "violates RULE-TRK-02: rejected events discarded" },
  { path: "b.go", line: 8, severity: "MEDIUM", body: "swallowed error" },
  { path: "c.go", line: 1, severity: "LOW", body: "style" },
];

describe("matchFindings", () => {
  it("matches same-path findings within the ±5-line window, greedy", () => {
    const m = matchFindings(exp, act);
    assert.equal(m.matched.length, 2);
    assert.equal(m.unmatchedActual.length, 1);
    assert.equal(m.unmatchedExpected.length, 0);
  });

  it("does not match beyond the window", () => {
    const m = matchFindings([{ path: "a.go", line_approx: 40, severity: "HIGH" }], [{ path: "a.go", line: 60, severity: "HIGH", body: "" }]);
    assert.equal(m.matched.length, 0);
    assert.equal(m.unmatchedExpected.length, 1);
  });
});

describe("evaluateCell", () => {
  it("computes precision, recall, severity match, rule citation", () => {
    const r = evaluateCell(exp, act);
    assert.equal(r.precision, 2 / 3);
    assert.equal(r.recall, 1);
    assert.equal(r.severity_match_rate, 0.5);
    assert.equal(r.rule_citation_rate, 1);
  });

  it("returns nulls on empty inputs", () => {
    const r = evaluateCell([], []);
    assert.equal(r.precision, null);
    assert.equal(r.recall, null);
    assert.equal(r.severity_match_rate, null);
    assert.equal(r.rule_citation_rate, null);
  });
});

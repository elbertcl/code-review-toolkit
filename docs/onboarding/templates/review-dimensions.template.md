# PR Review Dimensions

This file is the SSOT for what the reviewer checks and severity definitions.
It is referenced as `policy_path` in REVIEW.md.

---

## Section 1: Business Correctness

<!-- TODO: Add domain-specific correctness rules here. Examples: -->
<!-- - Entity invariants from docs/invariants/*.md -->
<!-- - AGENTS.md / CLAUDE.md coding rules -->
<!-- - Transaction safety requirements -->
<!-- - Cross-domain interaction rules -->

## Section 2: Performance

<!-- TODO: Add performance patterns to check. Examples: -->
<!-- - N+1 DB calls in loops -->
<!-- - Missing pagination on scan operations -->
<!-- - Unbounded queries -->

## Section 3: Maintainability & Code Quality

<!-- TODO: Add maintainability rules. Examples: -->
<!-- - Dead code, unused imports -->
<!-- - Over-decomposition (single-use helpers) -->
<!-- - Naming conventions -->
<!-- - Reuse discipline (check for existing utilities before writing new ones) -->

## Section 4: Observability

<!-- TODO: Add if applicable to your stack. Examples: -->
<!-- - Metrics on critical paths -->
<!-- - Structured logging -->
<!-- - Trace spans on cross-service calls -->

## Section 5: Cost Risk

<!-- TODO: Add if applicable. Examples: -->
<!-- - High-cardinality metric tags -->
<!-- - Excessive logging in hot paths -->

---

## Severity Definitions

| Severity | Meaning |
|----------|---------|
| Critical | Will break production, cause data loss, or violate a security invariant |
| High | Significant risk; should fix before merge unless explicitly deferred |
| Medium | Code quality or minor correctness issue; fix recommended |
| Low | Style nit or minor improvement; non-blocking |

## Dedup Rules

<!-- TODO: Define how duplicate findings are merged. Example: -->
<!-- - Same finding on same (file, line): keep highest severity -->
<!-- - Finding already covered by an existing open review thread: suppress -->

# V1 Operating Decisions

This document records the approved Toolkit Workstream 1 operating decisions and the
gates that remain unapproved. A pending gate is not approval to collect production data
or activate the pilot.

## Baseline and rollout

- V1 feature branches start from toolkit `v3.1.0` at commit `db218158`.
- Consumers pin a tested release commit SHA and retain the semantic version in a nearby
  workflow comment. Mutable release tags are not the production pinning mechanism.
- Rollback restores the prior tested release commit SHA in the consuming workflow.
- Toolkit ownership is temporarily assigned to `@elbertcl`.
- The control lane is manually initiated with an exact `/review` comment. The
  experimental lane is manually initiated with an exact `/review-serena` comment. V1
  does not automatically review every PR.
- Push events never invoke a model.

## GitHub Actions policy

- The organization setting **Allow GitHub Actions to create and approve pull requests**
  is disabled.
- The accountable policy owner and confirming evidence are pending.
- A daily drift check verifies that the setting remains disabled.

## Review policy

- Review evidence records the review purpose, approach and tradeoffs, commands run, and
  each command's result. Findings require evidence from the diff or repository context
  and include the relevant CI result where CI can validate the claim.
- A required evidence or CI gap produces a `BLOCKED` outcome. Missing required evidence
  must not be interpreted as a pass.
- Existing review threads are the source for outcome metrics, including whether findings
  are resolved, remain open, or are otherwise closed. V1 does not create a parallel
  finding-outcome store.
- Finding outcomes are classified as `accepted`, `disputed`, `deferred`, or
  `unclassified`.
- Until an approved metrics sink exists, metrics are calculated only from fixtures and
  local artifacts; production metrics collection is prohibited.
- The current metrics operating verdict is **POC_ONLY**. Any later verdict must use the
  contract in `docs/rollout-checklist.md`; absent or incomplete approval remains
  `POC_ONLY`.
- Metrics and evidence must never persist PR bodies, diffs, source code, or full review
  comments.
- Required repository context that is missing or contains
  `ASTRO_REVIEW_CONTEXT_INCOMPLETE` is `BLOCKED`. Selected conditional context has the
  same required semantics. Only optional gaps produce `READY_WITH_GAPS`.

## Organization profiles

Repository manifests select exactly one fixed stack pair: `backend/security` plus
`backend/sre`, or `frontend/security` plus `frontend/sre`. Repository policy may add
stricter checks but cannot override, disable, or downgrade mandatory `ORG-*` rules.
Security and SRE owner approval of the seeded profile content remains part of the pilot
activation gate.

## Measured Ads PR sample

The baseline covers human-authored PRs created in `astronautsid/astro-ads-be` from
2026-04-01 through 2026-07-28, inclusive. Bot-authored PRs are excluded and changed lines
are additions plus deletions.

| Measure | Sample size | p50 | p90 | p95 | Maximum | V1 limit |
|---|---:|---:|---:|---:|---:|---:|
| Changed files | 570 PRs | 6 | 26 | 34 | 192 | 35 |
| Changed lines | 570 PRs | 215 | 1,486 | 2,575 | 17,704 | 2,600 |

The V1 limits intentionally round the measured p95 values to 35 changed files and 2,600
changed lines. Reproduce the measurement with:

```bash
node scripts/analyze-pr-size.mjs astronautsid/astro-ads-be 2026-04-01 2026-07-28
```

Expected recorded output:

```json
{
  "sampleSize": 570,
  "changedFiles": { "p50": 6, "p90": 26, "p95": 34, "max": 192 },
  "changedLines": { "p50": 215, "p90": 1486, "p95": 2575, "max": 17704 }
}
```

## Pending gates

The following decisions are explicitly **PENDING GATES**:

| Gate | Pending approval or evidence | Effect while pending |
|---|---|---|
| Metrics governance | Metrics sink, access controls, retention period, deletion process, and the accountable owner for those controls | Production metrics collection cannot proceed. |
| Organization GitHub Actions policy | Policy owner and evidence that the toolkit's required Actions usage is approved by the organization | Pilot activation cannot proceed. |
| Supply-chain security | Security approval for the selected scanner and immutable commit-SHA pins for scanner/action dependencies | Pilot activation cannot proceed. |

Current CI candidates are `raven-actions/actionlint` at
`01fce4f43a270a612932cb1c64d40505a029f821` and `zizmorcore/zizmor-action` at
`f52a838cfabf134edcbaa7c8b3677dde20045018`. These immutable pins are recorded for
review, not an assertion of Security approval. Existing baseline action references that
still use movable tags are enumerated exactly in `legacy-action-pin-exceptions.json` and
must be migrated in their owning workstreams before hardened release activation. The
hardened review lane never accepts those exceptions.

Production collection and pilot activation remain prohibited until every applicable gate
above has documented approval. Approval of one gate does not imply approval of another.

The reusable OpenCode review workflow requires an exact `opencode_version`, immutable
HTTPS release-asset URL, and approved SHA-256 digest. It installs into isolated
runner-temporary storage, verifies the digest before running the binary, and verifies the
reported version; preinstalled PATH binaries and mutable installers are not trusted.
Consumers also pass the full 40-character approved release commit
as `toolkit_sha`, and every job verifies the isolated toolkit checkout before executing
it. This is intentionally separate from `github.workflow_sha`: in a reusable workflow,
that context describes the commit associated with the workflow run/caller and is not a
safe contract for selecting a commit in a separately named toolkit repository.
The toolkit SHA cannot be safely self-derived before the toolkit code is trusted, so the
POC retains this explicit consumer gate. Only release SHAs approved through the pending
supply-chain gate are valid consumer values.

Preflight reconstructs review state from all paginated issue comments, review comments,
commits, and GraphQL review threads. Checksummed artifacts are member-validated before
extraction, publication derives finding IDs through the toolkit's canonical module, and
blocked/incomplete comments are posted by the deterministic sanitized comment adapter.

## Ownership transfer

Follow-up ownership transfers from `elbertcl/code-review-toolkit` to
`astronautsid/code-review-toolkit`.

The operational sequence and rollback requirements are documented in
`docs/migration-to-astronautsid.md`. Transfer does not satisfy any pending production
gate.

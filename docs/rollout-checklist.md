# POC Rollout Checklist

## Current verdict

Operating decision: **POC_ONLY**. Do not activate a production metrics lane or pilot.

## Before a local or manual fixture run

- [ ] Confirm inputs contain only fields approved in `docs/metrics.md`.
- [ ] Run `node --test scripts/lib/*.test.mjs scripts/*.test.mjs`.
- [ ] Run `node scripts/check-immutable-action-pins.mjs`.
- [ ] Trigger `Metrics Dashboard POC` only from the trusted default branch.
- [ ] Inspect `summary.json`, `audit-sample.json`, and `index.html` for prohibited data.
- [ ] Delete downloaded artifacts after inspection; GitHub retention is one day.

## Production activation gates

- [ ] Metrics sink and accountable owner approved in writing.
- [ ] Access controls, retention, and deletion process approved and tested.
- [ ] Privacy review confirms the approved field allowlist.
- [ ] Security approves all action pins and the export path.
- [ ] Organization Actions policy owner provides approval evidence.
- [ ] Production collector pagination and idempotence pass against representative data.
- [ ] Incident owner, rollback authority, and escalation channel are named.
- [ ] A later operating verdict explicitly changes `POC_ONLY` to `PILOT_APPROVED`.

Unchecked gates are blockers, not implicit approval.

## Later verdict contract

The production decision must be recorded in `docs/v1-operating-decisions.md` with one of:

- `POC_ONLY`: fixtures/local artifacts only; no production collection or export.
- `PILOT_APPROVED`: named repositories, dates, sink, owner, retention, and rollback are all explicit.
- `PRODUCTION_APPROVED`: organization-wide scope and controls are explicitly approved.
- `SUSPENDED`: collection and export stop immediately while existing data follows the approved incident/deletion process.

Absence, ambiguity, or a pending field means `POC_ONLY`.

# Metrics POC Incident Runbook

## Scope

This runbook covers a fixture artifact containing prohibited content, unexpected workflow
execution, compromised action dependency, incorrect aggregate, or accidental production
collection. The current operating verdict is `POC_ONLY`.

## Containment

1. Cancel the workflow run and do not rerun it.
2. Delete the workflow artifact through GitHub Actions UI or API if it may contain PR body, diff, source, paths, hunks, or full comments.
3. Disable the workflow in repository settings if execution was unexpected or production data was accessed.
4. Preserve only run ID, timestamps, actor, immutable action SHAs, and a description of the prohibited field category. Do not copy sensitive payloads into tickets or chat.
5. Notify the repository owner and Security/privacy contacts. The accountable metrics owner is still pending, so production collection remains prohibited.

## Investigation and recovery

1. Identify whether the source was fixture input, collector allowlisting, matching, rendering, or artifact publication.
2. Add a failing privacy or idempotence regression test before changing implementation.
3. Rotate any token exposed to untrusted code and review the run's permission scope.
4. Verify deletion from every downloaded or exported location under the approved process. No production sink is currently approved.
5. Run all Node tests and the immutable-pin checker before re-enabling fixture-only runs.
6. Record the incident outcome without prohibited content.

Production collection cannot resume through this runbook. It requires a later explicit
`PILOT_APPROVED` or `PRODUCTION_APPROVED` verdict satisfying the rollout checklist.

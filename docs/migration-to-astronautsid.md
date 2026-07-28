# Migration to astronautsid

This POC remains owned in `elbertcl/code-review-toolkit` until the operating gates are
approved. Repository transfer alone does not approve production metrics collection.

## Migration sequence

1. Create or transfer the target repository to `astronautsid/code-review-toolkit` without changing history.
2. Establish astronautsid CODEOWNERS for toolkit, Security, and metrics governance.
3. Revalidate branch protection, Actions policy, environment protections, artifact retention, and secret visibility.
4. Replace every consumer reference with an immutable tested commit SHA from the target repository; retain the semantic version in a nearby comment.
5. Re-run Node tests, shell checks, workflow security checks, and the immutable action-pin checker in the target repository.
6. Keep the metrics workflow `workflow_dispatch` and fixture-only while the verdict is `POC_ONLY`.
7. Update documentation links and rollback SHA only after target-repository verification succeeds.
8. Archive the old repository or mark it read-only after all consumers are verified; do not create mutable compatibility tags as production pins.

## Rollback

Restore each consumer's previous tested repository and commit SHA. A migration rollback
does not copy or retain metrics artifacts. Any artifact handling follows
`docs/incident-runbook.md` and the approved retention/deletion process.

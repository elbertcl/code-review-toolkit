---
name: initialize-review-context
description: Discover bounded repository review context and propose or write a trusted REVIEW.md manifest without inventing policy.
---

# Initialize Review Context

Use the deterministic initializer from the toolkit checkout. Do not search arbitrary
documentation or source files, and do not summarize source code.

## Procedure

1. Run a non-mutating preview:

   ```bash
   node scripts/initialize-review-context.mjs --root /path/to/consumer
   ```

2. Supply repository-owner-approved verification commands, required check names, and
   measured diff limits. New manifests contain schema-valid, non-activatable owner
   placeholders and an `ASTRO_REVIEW_CONTEXT_INCOMPLETE` marker; the compiler blocks
   while that marker remains. Workflow names are discovery evidence only and are never
   copied into the manifest automatically. Add `app_slug` only when the owner supplies it.
3. Apply managed output only after approval:

   ```bash
   node scripts/initialize-review-context.mjs --root /path/to/consumer --write
   ```

4. Replace `ASTRO_REVIEW_CONTEXT_INCOMPLETE` stubs and the owner-confirmation marker
   with owner-approved content. The initializer creates required architecture, invariant,
   and testspec stubs for bounded `internal/domain/<name>/**` roots and maps each one as
   conditional context. Never remove the marker merely to change the verdict.
5. Run preview again. A stable initialized repository reports `No changes.`. Required
   stubs remain `BLOCKED`; optional stubs produce `READY_WITH_GAPS`.

If `REVIEW.md` already contains a manifest, the initializer treats the complete file as
owner-managed: it validates but does not rewrite the manifest, owner prose, values, paths,
checks, commands, or limits. Otherwise it appends exactly one managed manifest while
preserving all existing prose bytes. It never deletes repository files.

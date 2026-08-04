# Skill: initialize-review-context

## Description
Onboard a repository to the OCR review engine. Detects existing review docs,
generates or updates the root `REVIEW.md` manifest, creates gap stubs for missing
required docs, and reports an onboarding verdict.

## When to use
Run once when onboarding a repo to the review toolkit, or whenever review-context
docs are reorganized.

## Steps

1. **Detect docs.** Inspect `docs/architecture/*.md`, `docs/invariants/*.md`,
   `docs/testspecs/*/`, `docs/conventions/*.md`, `AGENTS.md`/`CLAUDE.md`.

2. **Generate REVIEW.md.** Write a root `REVIEW.md` containing exactly one manifest
   block:
   ```
   <!-- astro-review-manifest:start -->
   ```json
   { ...manifest per schema... }
   \`\`\`
   <!-- astro-review-manifest:end -->
   ```
   The manifest schema (schema_version 2) requires: policy_path, verification_commands,
   required_context, optional_context, conditional_context, required_checks, diff_limits,
   diff_override, docs_only_paths, excluded_paths. `profile` and `organization_profiles`
   are NOT repo-owned; they are set as the `org_profiles` workflow input.

   Map detected docs to required/optional/conditional context entries with roles from:
   instructions|policy|architecture|invariants|testspec|conventions|api-contract.

   Testspecs must use `conditional_context` (blocking), NOT `optional_context`.
   LOCKED and BOUNDED fields (`excluded_paths`, `diff_override`, `review_directives`,
   `diff_limits`, `docs_only_paths`) should be OMITTED from the repo manifest — they
   inherit from toolkit defaults.

3. **Create gap stubs.** For any REQUIRED doc that does not exist, create a stub
   file containing the sentinel `ASTRO_REVIEW_CONTEXT_INCOMPLETE` and a note that
   repo-owner input is required. The compiler treats any file containing this
   sentinel as incomplete and fails the review closed until it is filled.

4. **Validate.** Ensure the manifest parses against the v4.3 schema validator.

5. **Report verdict.**
   - READY — REVIEW.md exists and required context is complete.
   - READY_WITH_GAPS — REVIEW.md exists and gap stubs were created.
   - BLOCKED — required context could not be created, read, or validated.

## Notes
- Never invent business rules. Missing knowledge becomes a gap stub, not a fake rule.
- The consuming repo commits the workflow and REVIEW.md.
- `org_profiles` is set in the workflow's `with:` block, not the manifest.
- The reviewer is the OCR engine; there is no agent lane.
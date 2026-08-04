# Skill: initialize-review-context

## Description
Onboard a repository to the OpenCode review agent. Detects existing review docs,
generates or updates the root `REVIEW.md` manifest, creates gap stubs for missing
required docs, initializes the Serena index, and reports an onboarding verdict.

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
   ```
   <!-- astro-review-manifest:end -->
   ```
   The manifest schema (schema_version 1) requires: profile (backend|frontend),
   organization_profiles (exactly ["<profile>/security","<profile>/sre"]),
   policy_path, verification_commands, required_context, optional_context,
   conditional_context, required_checks, diff_limits, diff_override,
   docs_only_paths, excluded_paths. Map detected docs to required/optional/
   conditional context entries with roles from:
   instructions|policy|architecture|invariants|testspec|conventions|api-contract.

3. **Create gap stubs.** For any REQUIRED doc that does not exist, create a stub
   file containing the sentinel `ASTRO_REVIEW_CONTEXT_INCOMPLETE` and a note that
   repo-owner input is required. The compiler treats any file containing this
   sentinel as incomplete and fails the review closed until it is filled.

4. **Initialize Serena.** Run `serena init` (or `uvx --from git+https://github.com/oraios/serena.git serena project index`) to produce a committed `.serena/` project index.

5. **Report verdict.**
   - READY — REVIEW.md exists and required context is complete.
   - READY_WITH_GAPS — REVIEW.md exists and gap stubs were created.
   - BLOCKED — required context could not be created, read, or validated.

## Notes
- Never invent business rules. Missing knowledge becomes a gap stub, not a fake rule.
- The consuming repo commits only: the workflow, REVIEW.md, and .serena/.

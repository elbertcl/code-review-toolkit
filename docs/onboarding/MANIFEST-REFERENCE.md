# REVIEW.md Manifest Reference

Full field reference for the `REVIEW.md` manifest (schema v2).

## Structure

The manifest lives inside `REVIEW.md` as a single fenced JSON block wrapped in HTML comment markers:

```
<!-- astro-review-manifest:start -->
```json
{ ...manifest... }
```
<!-- astro-review-manifest:end -->
```

Exactly one block is required. Multiple blocks or missing markers cause validation failure.

## Fields

### schema_version
- **Type:** integer
- **Required:** Yes
- **Values:** `1` or `2`
- **Note:** Use `2` to enable `review_directives`. Schema v1 manifests remain valid.

### policy_path
- **Type:** string (exact file path, no globs)
- **Required:** Yes
- **Tier:** FREE
- **Description:** Path to the repo's review dimensions document (e.g. `docs/review-dimensions.md`).

### verification_commands
- **Type:** string[] (non-empty)
- **Required:** Yes
- **Tier:** FREE
- **Description:** Build/test/lint commands the review verifies.

### required_context
- **Type:** array of `{path, role}`
- **Required:** Yes (can be empty array)
- **Tier:** FREE
- **Description:** Context files always loaded for every review.
- **path:** exact file path, no globs, must be inside repo
- **role:** one of `instructions | policy | architecture | invariants | testspec | conventions | api-contract`

### optional_context
- **Type:** array of `{path, role}`
- **Required:** Yes (can be empty array)
- **Tier:** FREE
- **Description:** Context files loaded if present; absence is non-blocking.

### conditional_context
- **Type:** array of `{when_changed, paths, role}`
- **Required:** Yes (can be empty array)
- **Tier:** FREE
- **Description:** Context loaded when changed files match the glob patterns.
- **when_changed:** glob patterns (supports `*` and `**`, no character classes)
- **paths:** exact file paths loaded when any when_changed glob matches
- **role:** one of the valid roles
- **Note:** Testspecs MUST use conditional_context (blocking), not optional_context.

### required_checks
- **Type:** array of check objects
- **Required:** Yes (non-empty)
- **Tier:** FREE
- **Fields per entry:**
  - `name` (string, required) — check name
  - `category` (string, required) — one of `test | security | policy`
  - `workflow_file` (string, optional) — must start with `.github/workflows/`
  - `workflow_id` (integer, optional) — numeric workflow ID
  - `app_slug` (string, optional) — GitHub App slug
  - `allow_skipped` (boolean, optional)
  - `when_changed` (string[], optional) — glob patterns

### diff_limits
- **Type:** `{changed_files: integer, changed_lines: integer}`
- **Required:** Yes
- **Tier:** BOUNDED (ceiling: 100 files / 5000 lines)
- **Description:** Max PR size for review. Repo can set stricter (lower) values.

### diff_override
- **Type:** `{label: string, authorized_associations: string[]}`
- **Required:** Yes
- **Tier:** LOCKED (must match default exactly or omit)
- **Default:** `{"label": "ai-review-size-approved", "authorized_associations": ["OWNER", "MEMBER"]}`

### docs_only_paths
- **Type:** string[] (glob patterns)
- **Required:** Yes
- **Tier:** BOUNDED (union with default)
- **Default includes:** `["**/*.md", "docs/**"]`

### excluded_paths
- **Type:** string[] (glob patterns)
- **Required:** Yes
- **Tier:** LOCKED (union with default)
- **Default includes:** `["mocks/**", "vendor/**"]`

### review_directives
- **Type:** array of `{when_changed, directive}` (schema v2 only)
- **Required:** No (omitted = no directives)
- **Tier:** LOCKED defaults + FREE repo additions (unioned)
- **Description:** Path-scoped review guidance (e.g. "do not refactor compliant DB-layer code").
- **when_changed:** glob patterns
- **directive:** non-empty string

## Removed Fields (validation rejects these)

| Field | Reason | Replacement |
|-------|--------|-------------|
| `profile` | No longer repo-owned | Set via `org_profiles` workflow input |
| `organization_profiles` | No longer repo-owned | Set via `org_profiles` workflow input |

## Validation Rules

1. Exactly one manifest block (one start marker, one end marker)
2. JSON must parse
3. No unknown keys
4. All paths must be inside the repository (no `..`, no absolute paths)
5. Context paths must be exact files (no globs), not symlinks
6. Glob patterns support only `*` and `**` (no `[]` or `{}`)
7. All context paths must be unique across required/optional/conditional
8. If a required context file contains `ASTRO_REVIEW_CONTEXT_INCOMPLETE`, the review fails closed (BLOCKED)

## Tiered Defaults Merge Behavior

| Tier | Field | Merge Rule |
|------|-------|------------|
| LOCKED | `excluded_paths` | Union: repo paths + default paths |
| LOCKED | `diff_override` | Must equal default or omit |
| LOCKED | `review_directives` | Union: default directives prepended, repo directives appended |
| BOUNDED | `diff_limits` | Repo value if <= ceiling; error if exceeds; default if omitted |
| BOUNDED | `docs_only_paths` | Union: repo paths + default paths |
| FREE | All others | Repo value as-is |

## Valid Roles

| Role | Used for |
|------|----------|
| `instructions` | AGENTS.md, CLAUDE.md — top-level coding instructions |
| `policy` | Review dimensions, severity definitions |
| `architecture` | Domain architecture docs |
| `invariants` | Business rules, entity constraints, status transitions |
| `testspec` | E2E test specifications |
| `conventions` | Coding conventions (golang, database, naming, etc.) |
| `api-contract` | API contract definitions |

## Valid Check Categories

| Category | Used for |
|----------|----------|
| `test` | CI test workflows |
| `security` | Security scan workflows |
| `policy` | Lint / policy enforcement workflows |

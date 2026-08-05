# Onboarding a Repository to the AI Code Review Agent

This guide covers every scenario: new repos, existing repos with Serena, and
existing repos without Serena. Each step is mechanical — no product pipeline
changes.

For the full `REVIEW.md` field reference, see [MANIFEST-REFERENCE.md](MANIFEST-REFERENCE.md).
For adding new stacks (QA, Data, etc.), see [EXTENDING-TO-NEW-STACKS.md](EXTENDING-TO-NEW-STACKS.md).

---

## A. Prerequisites (org-level — done once)

These are set up by the toolkit maintainers, not per-repo. Verify they exist before onboarding:

| Prerequisite | Detail |
|--------------|--------|
| **Toolkit repo** | `elbertcl/code-review-toolkit` published at `@v4` tag |
| **Org secrets** | Two GitHub org-level secrets: `REVIEW_LLM_URL` (Astro AI Gateway endpoint) and `REVIEW_LLM_TOKEN` (auth token). Repos reference these by name in the workflow. |
| **Org profiles** | Shipped in the toolkit at `opencode-review/context/contexts/`: `backend/{security,sre}.md`, `frontend/{security,sre}.md` |
| **GitHub permissions** | The review workflow needs `pull-requests: write`, `issues: write`, `contents: read` |

If any are missing, contact the toolkit maintainers before proceeding.

---

## B. Decision Tree — Which Path?

```
Is this a NEW repo (greenfield) or EXISTING repo?
├── NEW → Section C
└── EXISTING → Does the repo already use Serena (.serena/project.yml exists)?
    ├── YES → Section D
    └── NO  → Section E
```

---

## C. Onboarding a NEW Repo (greenfield)

### Step 1 — Add the trigger workflow

Copy the appropriate template to `.github/workflows/opencode-pr-review.yml`:

- **Go backend repos:** [`templates/opencode-pr-review.yml`](templates/opencode-pr-review.yml)
- **Frontend repos (TS/React):** [`templates/opencode-pr-review.frontend.yml`](templates/opencode-pr-review.frontend.yml)

Set `org_profiles`:
- Backend repos: `backend/security,backend/sre`
- Frontend repos: `frontend/security,frontend/sre`
- Fullstack repos: all four (comma-separated)

### Step 2 — Generate REVIEW.md via the onboarding skill

The `initialize-review-context` skill detects existing docs, generates the manifest,
and creates gap stubs for missing required context.

```bash
# Clone the toolkit to a temp location
gh repo clone elbertcl/code-review-toolkit /tmp/crt

# Option A — Claude Code / OpenCode with local skills directory
cp -r /tmp/crt/skills/initialize-review-context .claude/skills/
# Then invoke the skill from your repo root

# Option B — Manual (read the skill and follow its steps)
cat /tmp/crt/skills/initialize-review-context/SKILL.md
```

The skill produces three outputs:

| Output | Description |
|--------|-------------|
| `REVIEW.md` | The manifest block with detected docs mapped to required/optional/conditional context |
| Gap stub files | Files containing `ASTRO_REVIEW_CONTEXT_INCOMPLETE` for missing required docs |
| Verdict | `READY`, `READY_WITH_GAPS`, or `BLOCKED` |

### Step 3 — Create docs/review-dimensions.md

This file is the `policy_path` — it defines **what the reviewer checks** and **severity definitions**.

Use [`templates/review-dimensions.template.md`](templates/review-dimensions.template.md) as the
starting point. Adapt the dimensions to your repo's domain (see Section G below).

### Step 4 — Fill gap stubs

For each gap stub the skill created:

- **If the doc should exist:** replace `ASTRO_REVIEW_CONTEXT_INCOMPLETE` with real content.
- **If the doc is not needed:** remove the entry from `REVIEW.md`'s `required_context` or `conditional_context`.

> **Never leave a gap stub committed.** The compiler treats any file containing
> `ASTRO_REVIEW_CONTEXT_INCOMPLETE` as incomplete and fails the review closed.

### Step 5 — Commit and verify

Commit `REVIEW.md`, `docs/review-dimensions.md`, the workflow file, and any new context docs.
Open a test PR and comment `/review` (or `/review-ocr` if the repo uses the legacy trigger).

Verify:
- A verdict comment appears with a **Context block** (Serena status + REVIEW.md loaded status)
- Findings are posted as **inline comments** on exact lines
- No "ORG-DEFAULT rules only" warning (means REVIEW.md failed to parse — check the validation error in the warning)

---

## D. Onboarding an EXISTING Repo (WITH Serena)

Follow Section C, with these differences:

### Already done — skip:
- `.serena/project.yml` exists. Verify it has the correct `languages:` entry (e.g. `go`, `typescript`) so the symbol index works for your stack.
- If `.opencode/opencode.json` exists, it already configures Serena as a local MCP server.

### The skill will detect:
- `.serena/` directory and map it as a tool dependency
- Existing `docs/invariants/`, `docs/conventions/`, `docs/testspecs/` (if they follow the standard layout)
- `AGENTS.md` / `CLAUDE.md` as instructions context

### Likely needs creating:
- `docs/review-dimensions.md` — this is repo-specific review policy. It may not exist yet. Create it from the template.
- `REVIEW.md` — the manifest. The skill generates it, but review the detected mappings against your actual doc structure.

---

## E. Onboarding an EXISTING Repo (WITHOUT Serena)

Follow Section C, with these differences:

### No Serena setup needed
The action's Serena step **fails open** — review proceeds on diff + rules alone.
No `.serena/` directory is required.

### Quality tradeoff (document this to your team)
Without Serena, the engine has **no cross-file context**. It will not know, for example,
that a changed function is called at `other_file.go:42`. Findings will be diff-localized —
correct for what's in the diff, but blind to cross-file breakage.

### Optional — add Serena later
You can add Serena at any time without re-onboarding:

```bash
# Install Serena CLI (pinned SHA — match the serena_sha input in action.yml)
uvx --from "git+https://github.com/oraios/serena@dd12fa032f473a53595763b8d731817e19c15475" serena init
```

Edit `.serena/project.yml`:
```yaml
project_name: "your-repo-name"
languages:
  - go          # or: typescript, python, etc.
```

Commit `.serena/project.yml`. The next review run will automatically pick up cross-file context.

---

## F. Configurations Needed (reference table)

| Config | File | Required? | Purpose |
|--------|------|-----------|---------|
| Trigger workflow | `.github/workflows/opencode-pr-review.yml` | **Yes** | Listens for `/review` comment; calls `opencode-review@v4` |
| Manifest | `REVIEW.md` (repo root) | **Yes** | Declares context sources, dimensions, checks, diff limits |
| Dimensions policy | `docs/review-dimensions.md` (or custom `policy_path`) | **Yes** | What to check + severity definitions |
| Org secrets | `REVIEW_LLM_URL`, `REVIEW_LLM_TOKEN` | **Yes** | LLM endpoint + auth (fail-closed if missing) |
| Serena config | `.serena/project.yml` | Optional | Cross-file symbol context (fail-open if absent) |
| OpenCode config | `.opencode/opencode.json` | Optional | Local review skills + MCP server config |

---

## G. Review Dimensions — What Each Repo Defines

The `docs/review-dimensions.md` file is the SSOT for what the reviewer checks.
Each repo defines its own dimensions based on its domain.

### Standard dimensions by stack

| Dimension | Backend | Frontend | Source material |
|-----------|---------|----------|-----------------|
| **Business Correctness** | Yes | Yes | Repo invariants, AGENTS.md rules, domain logic |
| **Performance** | Yes | Yes | N+1 queries, unbounded scans, render perf, bundle size |
| **Maintainability** | Yes | Yes | SonarQube thresholds, code style, reuse discipline |
| **Observability** | Yes | If services | Metrics/logs/traces standards |
| **Cost Risk** | Yes | Rarely | Metric cardinality, log volume, infra cost |
| **Security** | Via org profiles | Via org profiles | Injected by `org_profiles` — ORG-SEC-* rules |
| **SRE / Reliability** | Via org profiles | Via org profiles | Injected by `org_profiles` — ORG-SRE-* rules |
| **Accessibility** | N/A | Yes (if UI) | WCAG, semantic HTML, ARIA |

> **Key insight:** Security and SRE rules come from the **org profiles** (toolkit-owned),
> not the repo's dimensions doc. The repo's `docs/review-dimensions.md` focuses on
> domain-specific dimensions. Don't duplicate org rules in your dimensions doc.

### Severity definitions

Every dimensions doc must define severity levels. Standard tiers:

| Severity | Meaning |
|----------|---------|
| **Critical** | Will break production, cause data loss, or violate a security invariant |
| **High** | Significant risk; should be fixed before merge unless explicitly deferred |
| **Medium** | Code quality or minor correctness issue; fix recommended |
| **Low** | Style nit or minor improvement; non-blocking |

---

## H. REVIEW.md — Quick Start

The manifest is a single fenced JSON block inside `REVIEW.md`, wrapped in HTML comment markers:

```markdown
# Review Manifest

<!-- astro-review-manifest:start -->
```json
{
  "schema_version": 2,
  "policy_path": "docs/review-dimensions.md",
  ...
}
```
<!-- astro-review-manifest:end -->
```

For the full field reference (types, tiers, validation rules), see
[MANIFEST-REFERENCE.md](MANIFEST-REFERENCE.md).

### Tiered defaults

The toolkit ships defaults that repos cannot loosen:

| Tier | Fields | Rule |
|------|--------|------|
| **LOCKED** | `excluded_paths`, `diff_override`, `review_directives` | Repo cannot override; additions are unioned |
| **BOUNDED** | `diff_limits`, `docs_only_paths` | Repo can be stricter (lower limits, more paths); ceiling enforced |
| **FREE** | Everything else | Repo-owned, no restrictions |

> **Tip:** Omit LOCKED and BOUNDED fields from your manifest to inherit defaults.
> Only include them if you need stricter values.

---

## I. Using the Onboarding Skill (initialize-review-context)

The skill automates REVIEW.md generation. It:

1. **Detects docs** — scans `docs/architecture/`, `docs/invariants/`, `docs/testspecs/`,
   `docs/conventions/`, `AGENTS.md`/`CLAUDE.md`.
2. **Generates REVIEW.md** — maps detected docs to required/optional/conditional context
   with appropriate roles.
3. **Creates gap stubs** — for any required doc that doesn't exist, creates a stub file
   containing `ASTRO_REVIEW_CONTEXT_INCOMPLETE`.
4. **Validates** — ensures the manifest parses against the v4.3 schema validator.
5. **Reports a verdict** — READY, READY_WITH_GAPS, or BLOCKED.

### Roles (how docs are classified)

| Role | Used for |
|------|----------|
| `instructions` | AGENTS.md, CLAUDE.md — top-level coding instructions |
| `policy` | Review dimensions, severity definitions |
| `architecture` | Domain architecture docs |
| `invariants` | Business rules, entity constraints, status transitions |
| `testspec` | E2E test specifications (must use `conditional_context` — blocking) |
| `conventions` | Coding conventions (golang, database, naming, etc.) |
| `api-contract` | API contract definitions |

### Running the skill

```bash
# 1. Clone the toolkit
gh repo clone elbertcl/code-review-toolkit /tmp/crt

# 2. In your target repo, make the skill discoverable:
#    For Claude Code / OpenCode with .claude/skills/ directory:
cp -r /tmp/crt/skills/initialize-review-context .claude/skills/

# 3. Invoke the skill from your repo root
#    Claude Code: the skill auto-discovers; run it by name
#    OpenCode: ensure skills.paths includes .claude/skills in .opencode/opencode.json

# 4. Review the generated REVIEW.md and gap stubs
# 5. Remove the skill copy if you don't want it permanently:
rm -rf .claude/skills/initialize-review-context
```

> **Note:** The skill never invents business rules. Missing knowledge becomes a gap stub,
> not a fabricated rule.

---

## J. Verification Checklist

After onboarding, verify each item:

- [ ] `REVIEW.md` exists at repo root with exactly one manifest block
- [ ] `docs/review-dimensions.md` exists and is referenced by `policy_path`
- [ ] No gap stub files contain `ASTRO_REVIEW_CONTEXT_INCOMPLETE`
- [ ] Workflow file triggers on `/review` (or `/review-ocr`)
- [ ] `org_profiles` is set correctly in the workflow (`with:` block)
- [ ] `REVIEW_LLM_URL` and `REVIEW_LLM_TOKEN` secrets are accessible
- [ ] First test PR produces: verdict comment with Context block + inline findings
- [ ] No "ORG-DEFAULT rules only" warning in the verdict

---

## K. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Review aborted: missing required org_profiles input" | `org_profiles` not set in workflow | Add `org_profiles: backend/security,backend/sre` to `with:` block |
| "Review aborted: missing LLM configuration" | Secrets not configured | Add `REVIEW_LLM_URL` and `REVIEW_LLM_TOKEN` as repo or org secrets |
| "ORG-DEFAULT rules only" warning | `REVIEW.md` missing or failed validation | Check the validation error in the warning comment; fix the manifest |
| Review runs but no cross-file context | Serena unavailable or `.serena/` missing | Add `.serena/project.yml` (see Section E); Serena fails open, so review still works |
| "Review skipped: PR is still a draft" | PR is a draft | Mark PR as ready for review |
| "Re-review skipped: No changes since last review" | HEAD unchanged since last review | Push a new commit |
| Manifest validation error: "unknown key" | Typo or deprecated field in REVIEW.md | Compare against [MANIFEST-REFERENCE.md](MANIFEST-REFERENCE.md) |
| Manifest validation error: "profile/organization_profiles are no longer repo-owned" | Old v1 manifest with `profile` field | Remove `profile` and `organization_profiles` from the manifest; set `org_profiles` in the workflow instead |

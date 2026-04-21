# code-review-toolkit

Centralised GitHub Actions PR review infrastructure for astronautsid repos and beyond.

## What's in here

| Path | Purpose |
|---|---|
| `.github/workflows/_claude-pr-review-impl.yml` | Reusable review workflow (`workflow_call`) |
| `.github/workflows/_claude-pr-re-review-impl.yml` | Reusable re-review workflow (`workflow_call`) |
| `scripts/prepare-review-context.sh` | Bundles domain context before Claude runs; auto-discovers domains from `docs/` |
| `skills/review-pr/SKILL.md` | Generic 4-phase PR review skill |
| `skills/re-review-pr/SKILL.md` | Generic 9-phase PR re-review skill |

## What each consuming repo needs

1. `.github/workflows/claude-pr-review.yml` — trigger workflow (see template below)
2. `.github/workflows/claude-pr-re-review.yml` — trigger workflow for `/re-review`
3. `docs/review-dimensions.md` — repo-specific review rules

That's it. No other config needed.

## Secret naming convention

Create one secret per team member named **`CLAUDE_TOKEN_{github_username}`** (lowercase, matching the GitHub login exactly):

```
CLAUDE_TOKEN_elbertcl
CLAUDE_TOKEN_mariozul
CLAUDE_TOKEN_faviansyahap
# ... one per team member
```

The trigger workflows use `secrets[format('CLAUDE_TOKEN_{0}', github.event.comment.user.login)]` to look up each commenter's token dynamically. If no matching secret exists, the workflow posts a comment naming the exact secret that needs to be added.

## Trigger workflow template

Two files, ~15 lines each. Replace `<SHA>` with the pinned commit SHA.

**`.github/workflows/claude-pr-review.yml`:**
```yaml
name: Claude PR Review

on:
  issue_comment:
    types: [created]

# Bump SHA to adopt toolkit improvements: elbertcl/code-review-toolkit
jobs:
  review:
    if: |
      github.event.issue.pull_request != null &&
      github.event.comment.body == '/review'
    uses: elbertcl/code-review-toolkit/.github/workflows/_claude-pr-review-impl.yml@<SHA>
    secrets:
      claude_token: ${{ secrets[format('CLAUDE_TOKEN_{0}', github.event.comment.user.login)] }}
```

**`.github/workflows/claude-pr-re-review.yml`:**
```yaml
name: Claude Re-Review PR

on:
  issue_comment:
    types: [created]

# Bump SHA to adopt toolkit improvements: elbertcl/code-review-toolkit
jobs:
  re-review:
    if: |
      github.event.issue.pull_request != null &&
      github.event.comment.body == '/re-review'
    uses: elbertcl/code-review-toolkit/.github/workflows/_claude-pr-re-review-impl.yml@<SHA>
    secrets:
      claude_token: ${{ secrets[format('CLAUDE_TOKEN_{0}', github.event.comment.user.login)] }}
```

## How domain discovery works

`prepare-review-context.sh` discovers domain names at runtime by scanning the consuming
repo's own `docs/` structure (`docs/invariants/*.md`, `docs/architecture/*.md`,
`docs/testspecs/*/`). No hardcoded domain list. Adding a new domain to a repo requires
only adding its invariant/architecture doc — the review workflow picks it up automatically.

## Upgrading

1. Push improvements to `main` in this repo
2. `git rev-parse HEAD` to get the new SHA
3. Update the `@<SHA>` ref in each consuming repo's trigger workflows

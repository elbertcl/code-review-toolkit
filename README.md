# code-review-toolkit

Centralised GitHub Actions PR review infrastructure.

## What's in here

| Path | Purpose |
|---|---|
| `.github/workflows/_claude-pr-review-impl.yml` | Reusable review workflow (`workflow_call`) |
| `.github/workflows/_claude-pr-re-review-impl.yml` | Reusable re-review workflow (`workflow_call`) |
| `scripts/prepare-review-context.sh` | Bundles domain context before Claude runs; auto-discovers domains from `docs/` |
| `skills/review-pr/SKILL.md` | Generic 4-phase PR review skill |
| `skills/re-review-pr/SKILL.md` | Generic 9-phase PR re-review skill |

## What each consuming repo needs

1. `.github/workflows/claude-pr-review.yml` — trigger workflow (team usernames + `CLAUDE_TOKEN_*` secrets)
2. `.github/workflows/claude-pr-re-review.yml` — trigger workflow for `/re-review`
3. `docs/review-dimensions.md` — repo-specific review rules (Section 1 varies per repo; Sections 2–3 are reusable)

That's it. No other config needed.

## How domain discovery works

`prepare-review-context.sh` discovers domain names at runtime by scanning the consuming
repo's own `docs/` structure (`docs/invariants/*.md`, `docs/architecture/*.md`,
`docs/testspecs/*/`). No hardcoded domain list. Adding a new domain to a repo requires
only adding its invariant/architecture doc — the review workflow picks it up automatically.

## Trigger workflow template

```yaml
name: Claude PR Review

on:
  issue_comment:
    types: [created]

jobs:
  your-username:
    if: |
      github.event.issue.pull_request != null &&
      github.event.comment.body == '/review' &&
      github.event.comment.user.login == 'your-username'
    uses: elbertcl/code-review-toolkit/.github/workflows/_claude-pr-review-impl.yml@<SHA>
    secrets:
      claude_token: ${{ secrets.CLAUDE_TOKEN_YOUR_USERNAME }}
```

Pin to a specific commit SHA for stability. Bump to adopt toolkit improvements.

## Upgrading

1. Push improvements to `main`
2. `git rev-parse HEAD` to get the new SHA
3. Update the `@<SHA>` ref in each consuming repo's trigger workflows

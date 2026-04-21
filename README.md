# code-review-toolkit

AI-powered PR review infrastructure for astronautsid repos.

## Usage

Two composite actions — reference them from any repo's workflow:

| Action | Trigger command |
|---|---|
| `elbertcl/code-review-toolkit/review@v1` | `/review` comment on a PR |
| `elbertcl/code-review-toolkit/re-review@v1` | `/re-review` comment on a PR |

## Setup (per consuming repo)

### 1. Add secrets

One secret per team member, named `CLAUDE_TOKEN_{github_username}` (lowercase, matching the GitHub login exactly):

```
CLAUDE_TOKEN_elbertcl
CLAUDE_TOKEN_mariozul
CLAUDE_TOKEN_faviansyahap
```

### 2. Add trigger workflows

**`.github/workflows/claude-pr-review.yml`:**
```yaml
name: Claude PR Review

on:
  issue_comment:
    types: [created]

jobs:
  review:
    if: |
      github.event.issue.pull_request != null &&
      github.event.comment.body == '/review'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: elbertcl/code-review-toolkit/review@v1
        with:
          claude_token: ${{ secrets[format('CLAUDE_TOKEN_{0}', github.event.comment.user.login)] }}
```

**`.github/workflows/claude-pr-re-review.yml`:**
```yaml
name: Claude Re-Review PR

on:
  issue_comment:
    types: [created]

jobs:
  re-review:
    if: |
      github.event.issue.pull_request != null &&
      github.event.comment.body == '/re-review'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: elbertcl/code-review-toolkit/re-review@v1
        with:
          claude_token: ${{ secrets[format('CLAUDE_TOKEN_{0}', github.event.comment.user.login)] }}
```

### 3. Add `docs/review-dimensions.md`

Repo-specific review rules. Section 1 (Business Correctness) varies per repo; Sections 2–3 (Performance, Maintainability) are reusable. See any existing consumer repo for an example.

## How domain discovery works

`scripts/prepare-review-context.sh` discovers domain names at runtime by scanning the consuming repo's own `docs/` structure (`docs/invariants/*.md`, `docs/architecture/*.md`, `docs/testspecs/*/`). No config required — adding a domain doc is all it takes.

## Versioning

Pin to a tag (`@v1`, `@v1.0.0`) for stability. The tag covers both the action logic and the bundled skills/scripts.

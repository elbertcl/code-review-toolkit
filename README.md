# code-review-toolkit

AI-powered PR review infrastructure for astronautsid repos.

## Usage

One action, one command:

```yaml
- uses: elbertcl/code-review-toolkit/review@v1
```

Comment `/review` on any PR. The action automatically detects:
- **First-time review** — full review of the entire PR diff
- **Re-review** — classifies prior threads as resolved/still-open, then reviews only the new diff since the last review

## Setup (per consuming repo)

### 1. Add secrets

One secret per team member, named `CLAUDE_TOKEN_{github_username}` (lowercase, matching the GitHub login exactly):

```
CLAUDE_TOKEN_elbertcl
CLAUDE_TOKEN_mariozul
CLAUDE_TOKEN_faviansyahap
```

### 2. Add one trigger workflow

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

### 3. Add `docs/review-dimensions.md`

Repo-specific review rules. Section 1 (Business Correctness) varies per repo; Sections 2–3 (Performance, Maintainability) are reusable. See any existing consumer repo for an example.

## How domain discovery works

`scripts/prepare-review-context.sh` discovers domain names at runtime by scanning the consuming repo's own `docs/` structure (`docs/invariants/*.md`, `docs/architecture/*.md`, `docs/testspecs/*/`). No config required — adding a domain doc is all it takes.

## OpenCode Review With Team Token Routing

Use `opencode-review` when one API token should be shared by a GitHub team instead of one token per team member.

```yaml
- uses: elbertcl/code-review-toolkit/opencode-review@v1
  with:
    org: astronautsid
    team_token_map: |
      ads=${{ secrets.OPENCODE_API_KEY_ADS }}
    model: deepseek/deepseek-v4-pro
    variant: max
    mentions: /review
    share: false
```

`team_token_map` is evaluated in order. The first configured team containing the PR comment author selects the OpenCode API token.

Use `org` to control which GitHub organization is checked for team membership. If team membership is private, pass `team_lookup_token` with permission to read org team membership:

```yaml
team_lookup_token: ${{ secrets.REVIEW_TEAM_LOOKUP_TOKEN }}
```

Keep repo-specific review policy in the consuming repo, for example `docs/review-dimensions.md`, `AGENTS.md`, and `.github/instructions/review-depth.instructions.md`.

## Versioning

Pin to a tag (`@v1`, `@v1.0.0`) for stability. The tag covers both the action logic and the bundled skills/scripts.

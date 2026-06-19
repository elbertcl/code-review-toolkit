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

## OpenCode Review

Use `opencode-review` when you want OpenCode to review PRs from a `/review` comment. The consuming repo only needs the trigger workflow; review behavior, context preparation, inline comments, and the summary contract live in this toolkit.

### Single shared token

```yaml
name: OpenCode PR Review

on:
  issue_comment:
    types: [created]

permissions:
  contents: read
  id-token: write
  issues: write
  pull-requests: write

jobs:
  review:
    if: |
      github.event.issue.pull_request != null &&
      github.event.comment.body == '/review'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: elbertcl/code-review-toolkit/opencode-review@v1
        with:
          opencode_api_key: ${{ secrets.OPENCODE_API_KEY }}
          use_github_token: true
```

Keep repo-specific review policy in the consuming repo, for example `AGENTS.md`, `docs/review-dimensions.md`, or `.github/instructions/review-depth.instructions.md`.

### Team token routing

Use `opencode-review` when one API token should be shared by a GitHub team instead of one token per team member.

```yaml
- uses: elbertcl/code-review-toolkit/opencode-review@v1
  with:
    org: astronautsid
    team_token_map: |
      ads=${{ secrets.OPENCODE_API_KEY_ADS }}
    model: opencode-go/deepseek-v4-pro
    variant: max
    mentions: /review
    share: false
    use_github_token: true
```

`team_token_map` is evaluated in order. The first configured team containing the PR comment author selects the OpenCode API token.

Use `org` to control which GitHub organization is checked for team membership. If team membership is private, pass `team_lookup_token` with permission to read org team membership:

```yaml
team_lookup_token: ${{ secrets.REVIEW_TEAM_LOOKUP_TOKEN }}
```

Use direct `opencode_api_key` for one shared token. Use `team_token_map` when different GitHub teams should route to different OpenCode API tokens.

## Versioning

Pin to a tag (`@v1`, `@v1.0.0`) for stability. The tag covers both the action logic and the bundled skills/scripts.

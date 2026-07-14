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
      - uses: elbertcl/code-review-toolkit/opencode-review@v3.0.0
        with:
          api_key: ${{ secrets.REVIEW_AGENT_API_KEY }}
          api_key_env: OPENROUTER_API_KEY
          model: openrouter/deepseek/deepseek-v4-pro
          use_github_token: true
```

Keep repo-specific review policy in the consuming repo, for example `AGENTS.md`, `docs/review-dimensions.md`, or `.github/instructions/review-depth.instructions.md`.

## OpenCode Autofix

Use `opencode-autofix` to let OpenCode apply scoped review fixes from an `/autofix`
comment. It reads findings from the latest OpenCode review verdict (the
`<!-- findings-json-start -->` block) plus inline `[SEVERITY]` review comments, fixes
only the selected severities, runs the repo's own verification commands as a hard
gate, and **guarantees the PR branch never ends in a broken state** — on gate failure
it force-restores the PR head to the pre-autofix commit.

```yaml
name: OpenCode PR Autofix

on:
  issue_comment:
    types: [created]

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  autofix:
    if: |
      github.event.issue.pull_request != null &&
      (github.event.comment.body == '/autofix' || startsWith(github.event.comment.body, '/autofix '))
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: true
      - uses: elbertcl/code-review-toolkit/opencode-autofix@v3.0.0
        with:
          api_key: ${{ secrets.REVIEW_AGENT_API_KEY }}
          api_key_env: OPENROUTER_API_KEY
          model: openrouter/deepseek/deepseek-v4-pro
          use_github_token: true
          verify_commands: |
            make build-all
            make test
            make lint
            make lint-gci-new
```

Usage: `/autofix` (defaults to `CRITICAL,HIGH`), `/autofix HIGH,MEDIUM`, `/autofix ALL`.

### Reusing across repos without quality loss

Everything repo-specific is an **input**, not forked code — adopting repos only add the
trigger workflow above:

- `verify_commands` — the build/test/lint commands run as both the fixer's self-verify
  loop and the post-fix gate (single source of truth).
- `excluded_paths` — paths autofix must never touch (migrations, generated code).
- `git_token` — set a PAT here when `verify_commands` builds against **private
  cross-repo** Go modules; defaults to the repo `GITHUB_TOKEN`.
- `context_paths` / `extra_prompt` — point at any repo's own docs/spec.

Context is **layered and degrades gracefully**: `AGENTS.md`/`CLAUDE.md` is the universal
baseline; `docs/invariants|architecture|testspecs` are loaded automatically *if present*
(reusing `scripts/prepare-review-context.sh`); `context_paths` is the escape hatch for
repos with a different docs layout. No repo is forced to adopt an opinionated structure.

### Gate-before-push strategy

`strategy: rollback` (default) is correct on any runner: the OpenCode wrapper commits to
the PR branch, gates run, and a failure force-restores the PR head — the branch never
*ends* broken. `strategy: sandbox` additionally avoids the transient broken commit by
staging the wrapper's work on a scratch branch and fast-forwarding only when gates pass;
it depends on the wrapper honoring the checked-out branch, so validate that on your runner
before switching.

## Versioning

Pin to a tag (`@v1`, `@v1.0.0`) for stability. The tag covers both the action logic and the bundled skills/scripts.

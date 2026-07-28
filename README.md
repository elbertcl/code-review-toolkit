# code-review-toolkit

AI-powered PR review infrastructure for astronautsid repos.

## Usage

Replace `TOOLKIT_RELEASE_SHA` below with an approved, exact 40-character toolkit commit
SHA before committing the workflow. The literal token is intentionally invalid and must
not pass repository pin validation.

```yaml
- uses: elbertcl/code-review-toolkit/review@TOOLKIT_RELEASE_SHA
```

Comment `/review` on any PR. The action automatically detects:
- **First-time review** — full review of the entire PR diff
- **Re-review** — classifies prior threads as resolved/still-open, then reviews only the new diff since the last review

V1 feature branches start from toolkit `v3.1.0` (`db218158`). Consumers must pin the
tested release commit SHA and include the semantic version in a comment, rather than
using a mutable tag:

```yaml
- uses: elbertcl/code-review-toolkit/opencode-review@<future-release-commit-sha> # v3.2.0 (example future release)
```

Toolkit `v3.1.0` (`db218158`) remains the control and rollback target. Rollback means
restoring that prior tested release SHA in the consuming workflow. See
[`docs/v1-operating-decisions.md`](docs/v1-operating-decisions.md) for the V1 limits,
gates, and operating decisions.

## Metrics dashboard POC

Metrics currently operate as **POC_ONLY**. The manual `Metrics Dashboard POC` workflow
renders checked-in sanitized fixture metadata into `index.html`, `summary.json`, and
`audit-sample.json`. It does not collect production GitHub data, run on a schedule,
deploy Pages, or export to an external sink. See [`docs/metrics.md`](docs/metrics.md),
[`docs/rollout-checklist.md`](docs/rollout-checklist.md), and
[`docs/incident-runbook.md`](docs/incident-runbook.md).

Ownership transfer steps are in
[`docs/migration-to-astronautsid.md`](docs/migration-to-astronautsid.md). A repository
transfer does not change the `POC_ONLY` verdict or approve production collection.

## PR size baseline

Analyze a repository's human-authored PR sizes with:

```bash
node scripts/analyze-pr-size.mjs astronautsid/astro-ads-be 2026-04-01 2026-07-28
```

Recorded output for the Ads sample:

```json
{
  "sampleSize": 570,
  "changedFiles": { "p50": 6, "p90": 26, "p95": 34, "max": 192 },
  "changedLines": { "p50": 215, "p90": 1486, "p95": 2575, "max": 17704 }
}
```

V1 uses rounded p95 limits of **35 changed files** and **2,600 changed lines**.

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
      # Replace TOOLKIT_RELEASE_SHA with the approved 40-character release commit SHA.
      - uses: elbertcl/code-review-toolkit/review@TOOLKIT_RELEASE_SHA
        with:
          claude_token: ${{ secrets[format('CLAUDE_TOKEN_{0}', github.event.comment.user.login)] }}
```

### 3. Add `docs/review-dimensions.md`

Repo-specific review rules. Section 1 (Business Correctness) varies per repo; Sections 2–3 (Performance, Maintainability) are reusable. See any existing consumer repo for an example.

## Trusted review manifest

V1 consumers declare exact repository-owned review context in root `REVIEW.md`. The
toolkit reads the manifest and every declared repository file from the trusted base
commit with `git show`; PR-head policy changes cannot weaken the current review. The
fixed organization profile allowlist is `backend/security`, `backend/sre`,
`frontend/security`, and `frontend/sre`.

````markdown
<!-- astro-review-manifest:start -->
```json
{
  "schema_version": 1,
  "profile": "backend",
  "organization_profiles": ["backend/security", "backend/sre"],
  "policy_path": "docs/review-dimensions.md",
  "verification_commands": ["make lint"],
  "required_context": [{"path":"AGENTS.md","role":"instructions"}],
  "optional_context": [{"path":"docs/testspecs/display/spec.md","role":"testspec"}],
  "conditional_context": [{
    "when_changed": ["internal/domain/admanager/**"],
    "paths": ["docs/architecture/admanager.md", "docs/invariants/admanager.md"],
    "role": "invariants"
  }],
  "required_checks": [{"name":"Build and Test","category":"test","workflow_file":".github/workflows/ci.yml","workflow_id":123456}],
  "diff_limits": {"changed_files":40,"changed_lines":1200},
  "diff_override": {"label":"ai-review-size-approved","authorized_associations":["OWNER","MEMBER"]},
  "docs_only_paths": ["**/*.md", "docs/**"],
  "excluded_paths": ["mocks/**", "**/*.pb.go"]
}
```
<!-- astro-review-manifest:end -->
````

Required and selected conditional files are blocking when missing, unsafe, or marked
`ASTRO_REVIEW_CONTEXT_INCOMPLETE`. Optional gaps produce `READY_WITH_GAPS`; otherwise
the result is `READY`. Organization rules take precedence. To keep precedence
deterministic, repository policy must not contain any mandatory organization rule ID;
neutral descriptions should refer to "organization rules" without copying an `ORG-*` ID.

The compiler writes `.opencode/tmp/review_context.md` and
`.opencode/tmp/review_context.metadata.json`. It rejects path traversal, symlinks,
unsupported glob syntax, and output over the configured byte cap rather than truncating
required context.

Metadata includes the full validated manifest contract. Workstream 3 consumes
`required_checks`, diff limits and override policy, docs-only paths, exclusions, and
verification commands when enforcing the action gate; this compiler only preserves and
authenticates that contract.

### Deterministic context initialization

Preview a consuming repository's bounded context discovery without changing files:

```bash
node scripts/initialize-review-context.mjs --root /path/to/consumer
```

The initializer inspects only root instruction files, bounded `internal/domain/*/` names,
`docs/architecture/*.md`,
`docs/invariants/*.md`, `docs/testspecs/*/*.md`, `docs/conventions/*.md`,
`.github/workflows/*.yml`, and known root stack indicators. It never recursively scans
arbitrary documentation and never reads or summarizes application source.

After a repository owner reviews the preview, write the managed manifest and missing
required stubs with:

```bash
node scripts/initialize-review-context.mjs --root /path/to/consumer --write
```

The command preserves all existing `REVIEW.md` prose and never deletes files. An existing
manifest is validated without rewriting owner-selected values, paths, checks, commands,
or limits. A new manifest uses non-activatable owner placeholders and carries
`ASTRO_REVIEW_CONTEXT_INCOMPLETE` until an owner supplies measured limits, commands, and
checks. Workflow names are discovery evidence only; no `app_slug` is guessed. Discovered
domains receive marked architecture, invariant, and testspec stubs selected conditionally
by `internal/domain/<name>/**`. Required stubs produce `BLOCKED`, optional stubs produce
`READY_WITH_GAPS`, and a second write is idempotent (`No changes.`).

See [`skills/initialize-review-context/SKILL.md`](skills/initialize-review-context/SKILL.md)
for the adoption procedure and `templates/review-context/` for stub wording.

`app_slug` is optional and identifies an app, not a trusted workflow. When provenance
matters, declare `workflow_file` and optionally `workflow_id`; the gate requires the check
run's trusted-base workflow identity to match. A name or `github-actions` slug alone is
not secure provenance. Size overrides require both an association allowlisted by
`diff_override.authorized_associations` and current write-or-higher repository access.
The reusable workflow requires `toolkit_sha` to be the exact 40-character release commit,
checks out consumer code and `elbertcl/code-review-toolkit` into separate directories,
and verifies that toolkit checkout before executing it. `github.workflow_sha` is not used
as the cross-repository revision contract: for reusable workflows it identifies the
workflow run/caller commit, not necessarily a commit available in the separately checked
out toolkit repository. Private-repository fetches use
transient HTTP authentication and deepen history only until the gated base/head pair
has a merge base; credentials are never persisted.

The reusable workflow requires `opencode_version`, `opencode_download_url`, and
`opencode_sha256`. The URL must be an immutable HTTPS asset under the exact version's
`/releases/download/v<version>/` path. The workflow downloads it into runner-temporary
storage, verifies SHA-256 before execution, then verifies `--version`; it never trusts a
preinstalled `opencode` on `PATH` or runs a mutable installer.

## OpenCode Review

Use the reusable `opencode-review.yml` workflow for the hardened experimental review
lane. The old step-level example below is the legacy control lane and is not the hardened
consumer contract.

```yaml
jobs:
  review:
    if: github.event.issue.pull_request != null && github.event.comment.body == '/review'
    uses: elbertcl/code-review-toolkit/.github/workflows/opencode-review.yml@<approved-release-sha> # approved release
    with:
      toolkit_sha: <same-approved-release-sha>
      model: openrouter/deepseek/deepseek-v4-pro
      variant: max
      opencode_version: 1.2.3
      opencode_download_url: https://github.com/anomalyco/opencode/releases/download/v1.2.3/opencode-linux-x64
      opencode_sha256: <verified-lowercase-64-character-digest>
    secrets:
      api_key: ${{ secrets.REVIEW_AGENT_API_KEY }}
```

`toolkit_sha` cannot safely derive the reusable workflow's own release commit across
repositories. The consumer must repeat the exact, approved 40-character release SHA;
arbitrary branch or pre-commit SHAs are not approved pins.

Keep repo-specific review policy in the consuming repo, for example `AGENTS.md`, `docs/review-dimensions.md`, or `.github/instructions/review-depth.instructions.md`.

### Model & provider configuration

`opencode-review` and `opencode-autofix` (both the composite action and the reusable
`opencode-autofix.yml` workflow) take two knobs in the normal case:

| Input | What it is | Who defines the valid values |
|---|---|---|
| `model` | `<provider>/<model>` string passed straight through to the `opencode` CLI | opencode's own model catalog ([models.dev](https://models.dev)) — **not** a toolkit convention. The CLI splits on the first `/`; everything after is the model ID as that provider names it. |
| `api_key` | The secret value | Whatever your repo's GitHub secret holds — the **secret's name** (`REVIEW_AGENT_API_KEY`, `OPENCODE_API_KEY`, anything) is your choice and irrelevant to opencode. |

Under the hood, `opencode` reads auth from a fixed env var name per provider
(`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, ...), independent of what your GitHub secret
is called. The toolkit derives that name automatically from `model`'s provider prefix, so
you don't need to know it:

| `model` prefix | env var used | Notes |
|---|---|---|
| `opencode-go/...` | `OPENCODE_API_KEY` | opencode's hosted gateway (default) |
| `openrouter/...` | `OPENROUTER_API_KEY` | e.g. `openrouter/deepseek/deepseek-v4-pro` |
| `anthropic/...` | `ANTHROPIC_API_KEY` | |
| `openai/...` | `OPENAI_API_KEY` | |
| `deepseek/...` | `DEEPSEEK_API_KEY` | DeepSeek's own API, not via a router |
| `groq/...` | `GROQ_API_KEY` | |

A third input, `api_key_env`, exists only as an **override** for a provider not in that
table — leave it unset for anything above. If `model` uses a provider prefix the table
doesn't recognize and `api_key_env` isn't set, the run fails fast with a clear error
rather than silently sending the key to the wrong place.

Verify any provider/model combo against opencode's live catalog before using it —
`curl -sf https://models.dev/api.json | jq '.<provider>'` — rather than guessing a model ID.

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
      - uses: elbertcl/code-review-toolkit/opencode-autofix@v3.1.0
        with:
          api_key: ${{ secrets.REVIEW_AGENT_API_KEY }}
          model: openrouter/deepseek/deepseek-v4-pro
          use_github_token: true
          verify_commands: |
            make build-all
            make test
            make lint
            make lint-gci-new
```

Usage: `/autofix` (defaults to `CRITICAL,HIGH`), `/autofix HIGH,MEDIUM`, `/autofix ALL`.

### OpenCode Autofix — reusable multi-job variant

`opencode-autofix@v3.1.0` above is a single-job composite action: gate commands run
sequentially on one runner. `.github/workflows/opencode-autofix.yml` is the same fixer
split across parallel jobs (`fix` → `lint` + `build` + `test` in parallel → `publish`) —
use it when the gate commands are slow enough that CPU contention on one runner matters.
Same `api_key`/`model` contract (`api_key_env` auto-derives here too), but gate commands
are split into three inputs instead of one `verify_commands` block, called via
`workflow_call` not `uses:` on a step:

```yaml
jobs:
  autofix:
    if: |
      github.event.issue.pull_request != null &&
      (github.event.comment.body == '/autofix' || startsWith(github.event.comment.body, '/autofix '))
    uses: elbertcl/code-review-toolkit/.github/workflows/opencode-autofix.yml@v3.1.0
    with:
      use_github_token: true
      model: openrouter/deepseek/deepseek-v4-pro
      variant: max
      verify_lint_command: make lint-new
      verify_build_command: make build-all
      verify_test_command: make test
      base_branch: develop
      setup_go: true
      go_version_file: go.mod
      golangci_lint_version: v2.12.2
    secrets:
      api_key: ${{ secrets.REVIEW_AGENT_API_KEY }}
      git_token: ${{ secrets.workflow_token }}
```

Note the split: `model`/`variant` are plain `with:` inputs, but `api_key` (the actual
secret value) goes under `secrets:` — `workflow_call` keeps the two separate so secret
values get masking guarantees plain inputs don't.

### Reusing across repos without quality loss

Everything repo-specific is an **input**, not forked code — adopting repos only add the
trigger workflow above:

- `verify_commands` — the build/test/lint commands run as both the fixer's self-verify
  loop and the post-fix gate (single source of truth).
- `excluded_paths` — paths autofix must never touch (migrations, generated code).
- `git_token` — set a PAT here when `verify_commands` builds against **private
  cross-repo** Go modules; defaults to the repo `GITHUB_TOKEN`.
- `context_paths` / `extra_prompt` — point at any repo's own docs/spec.

Autofix remains on the deployed `v3.1.0` context behavior. The V1 trusted manifest and
`.opencode/tmp/review_context.md` contract apply to the experimental review lane only;
autofix migration is explicitly outside this workstream.

The hardened `opencode-review` lane requires immutable external action pins. Existing
control/autofix lanes retain a temporary, exact inventory in
`docs/legacy-action-pin-exceptions.json`; CI rejects new mutable refs and stale or
unrecorded exceptions. Those legacy owners must replace each recorded tag with a vetted
commit SHA before hardened release activation.

### Gate-before-push strategy

`strategy: rollback` (default) is correct on any runner: the OpenCode wrapper commits to
the PR branch, gates run, and a failure force-restores the PR head — the branch never
*ends* broken. `strategy: sandbox` additionally avoids the transient broken commit by
staging the wrapper's work on a scratch branch and fast-forwarding only when gates pass;
it depends on the wrapper honoring the checked-out branch, so validate that on your runner
before switching.

## Versioning

Pin to a tag (`@v1`, `@v1.0.0`) for stability. The tag covers both the action logic and the bundled skills/scripts.

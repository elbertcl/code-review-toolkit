# code-review-toolkit

AI-powered PR review infrastructure for astronautsid repos.

## Usage

**Default trigger: review on every push + `/review` comment**, via one reusable workflow:

```yaml
name: PR Review

on:
  pull_request:
    types: [opened, synchronize]
  issue_comment:
    types: [created]

concurrency:
  group: review-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true

jobs:
  review:
    if: |
      (github.event_name == 'issue_comment' &&
       github.event.issue.pull_request != null &&
       github.event.comment.body == '/review') ||
      (github.event_name == 'pull_request')
    uses: elbertcl/code-review-toolkit/.github/workflows/pr-review.yml@v4
    with:
      org_profiles: backend/security,backend/sre
    secrets:
      ocr_llm_url: ${{ secrets.OCR_POC_LLM_URL }}
      ocr_llm_token: ${{ secrets.OCR_POC_LLM_TOKEN }}
      metrics_datadog_api_key: ${{ secrets.DATADOG_API_KEY }}
```

The action automatically detects:
- **First-time review** — full review of the entire PR diff
- **Re-review** — classifies prior threads as resolved/still-open, then reviews only the new diff since the last review
- **Drafts are skipped**; the same HEAD is never reviewed twice (loop guard); force-push noise is bounded by the `concurrency` cancel group

**Manual-only alternative:** copy the slim `issue_comment`-only trigger and call the composite action directly (`elbertcl/code-review-toolkit/opencode-review@v4`) as before.

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

## Review context (v4)

The `opencode-review` action compiles review context internally from the
consuming repo's committed `REVIEW.md` manifest (read from the PR base ref) and
the org contexts bundled in this action (`opencode-review/context/contexts/`).
Missing or incomplete required context fails the review closed (`BLOCKED`).

### Manifest schema v2 (`review_directives`)

Schema v2 adds an optional `review_directives` field for path-scoped review
guidance (e.g., "do not refactor compliant DB-layer code"). Schema v1 manifests
remain valid and do not need upgrading. Set `"schema_version": 2` in
`REVIEW.md` to use directives. The field is optional — absent means no
directive rules.

### OCR engine

OCR runs **unconditionally** since v4.3.1 — it is the sole review path and no longer
gated on a boolean toggle. OCR receives manifest-derived rules with full org+policy+per-domain
parity — the same `REVIEW.md` that drives the agent's `review_context.md` also
generates OCR's `rule.json`. The action:

1. Validates OCR secrets (fail-closed if missing)
2. Compiles OCR rules from `REVIEW.md` (org contexts + policy dimensions + per-domain invariants)
3. Runs `@alibaba-group/open-code-review` against the PR diff
4. Posts findings as inline comments, suppressing duplicates by open-thread anchor
5. Appends a lane measurement row

Consumer setup is a thin workflow that only passes the flag:

```yaml
- uses: elbertcl/code-review-toolkit/opencode-review@v4
  with:
    mentions: /review-ocr
    use_github_token: true
    ocr_llm_url: ${{ secrets.OCR_POC_LLM_URL }}
    ocr_llm_token: ${{ secrets.OCR_POC_LLM_TOKEN }}
```

**Per-repo model choice:** pass `ocr_model` (default `deepseek/deepseek-v4-pro`). Verify IDs
against the provider catalog (`curl -sf https://models.dev/api.json | jq '.<provider>'`).

**Observability (opt-in):** set `metrics_datadog_api_key` (+ `metrics_datadog_site`) to push
per-run efficiency/context/reliability metrics (D1/D4/D5) at review time — best-effort, never
fails the review. Add the PR-closed outcome workflow to also collect quality metrics (D2/D3):

```yaml
name: Review Outcome
on:
  pull_request:
    types: [closed]
jobs:
  outcome:
    uses: elbertcl/code-review-toolkit/.github/workflows/review-outcome.yml@v4
    with:
      pr_number: ${{ github.event.pull_request.number }}
    secrets:
      metrics_datadog_api_key: ${{ secrets.DATADOG_API_KEY }}
```

All metrics land in the shared `code-review-toolkit` Datadog dashboard
(`docs/dashboard/datadog-code-review-toolkit.json`), sliced by `repo` and `model` tags:
cost/tokens/elapsed, observed precision & estimated recall (from thread outcomes at PR
close), rule-citation rate, context sizes, and reliability counters (fallback, Serena
fail-open, BLOCKED).

**OCR thread awareness — what it does and its ceiling:** OCR uses `--background-file` to carry
a budgeted (~8KB) reasoning digest that includes:
- **Resolved-thread human reasoning** — OCR reads *why* a thread was resolved via the digest,
  so reply semantics reach OCR indirectly without a second LLM pass.
- **Moved lines** — OCR follows GitHub API-remapped current lines; moved-line anchors are
  resolved deterministically before dedup.
- **Resolved-thread suppression** — findings matching a GitHub-resolved thread are classified
  as `resolved` (suppressed) and do not generate new inline comments.

**Residual gap:** The 8KB budget ceiling means long or many resolved threads are truncated.
Unresolved-but-disputed threads (not marked "Resolved" in GitHub) are anchor-only — no human
reasoning reaches OCR for active discussions where the reviewer has not clicked "Resolve."

### Cost tracking

The OCR CLI emits token usage and timing data on every run. The toolkit captures
this and surfaces it in two places:

1. **Verdict comment footer** — every review comment ends with a `**Run:**` line
   showing token counts, elapsed time, and (if rates are configured) dollar cost.

2. **Telemetry artifact** — the `review-telemetry-<run_id>` artifact includes the
   full measurement row: `tokens`, `cost`, `elapsed_ms`, `severity_tally`,
   `tool_calls`, and `suppressed_as_duplicate`.

Dollar cost is **opt-in**. Provide the `ocr_cost_rates` input as a JSON object
mapping model IDs to per-million-token rates:

```yaml
- uses: elbertcl/code-review-toolkit/opencode-review@v4
  with:
    ocr_llm_url: ${{ secrets.OCR_POC_LLM_URL }}
    ocr_llm_token: ${{ secrets.OCR_POC_LLM_TOKEN }}
    ocr_cost_rates: '{"deepseek/deepseek-v4-pro":{"input_per_million":0.14,"output_per_million":0.28,"cache_read_per_million":0.014}}'
```

When omitted, the footer shows tokens and elapsed time only — no dollar amount.

### Serena context fetcher

A deterministic MCP stdio client (no LLM) drives Serena headless in CI to produce a bounded
~2000-char **pointer artifact** for the OCR `--background-file`. The fetcher:
- Enumerates symbols per changed file via `get_symbols_overview`
- Resolves cross-file references via `find_referencing_symbols`
- Caps enumeration by changed-file count (overflow → skip enrichment for overflow files)
- **Fails open** — if Serena is unavailable, OCR proceeds on diff + rules alone

### `org_profiles` input (required for OCR)

Consuming workflows must pass the organization profiles as a comma-separated input:

```yaml
with:
  org_profiles: backend/security,backend/sre
```

Valid values: `backend/security`, `backend/sre`, `frontend/security`, `frontend/sre`.
Multi-profile repos use both backend and frontend profiles; `fullstack` = all four.
**Fail-closed:** empty or unknown profiles abort the review.

### Tiered defaults (enforced at runtime)

The toolkit ships locked and bounded defaults (`context/defaults/manifest-defaults.json`),
applied by `resolve-manifest` before every review:
- **LOCKED** fields: `excluded_paths` (union), `diff_override` (must equal default),
  `review_directives` (toolkit directives prepended) — repos cannot loosen these.
- **BOUNDED** fields: `diff_limits` (ceiling 100 files / 5000 lines — repo must be ≤),
  `docs_only_paths` (union).

These keys are required in the repo manifest (copy them from `REVIEW.example.md`);
their values are validated against the toolkit defaults on every run. A repo that
exceeds a ceiling or weakens a locked value is blocked (status BLOCKED).

### Required-context enforcement

`resolve-manifest` also classifies context: a missing or incomplete (`ASTRO_REVIEW_CONTEXT_INCOMPLETE`)
required_context file — or a conditional_context doc whose `when_changed` glob matches the
diff — blocks the review (status BLOCKED). Set `fail_closed_context: "false"` in the workflow
to downgrade this to a warning during migration. Optional-context gaps produce a
READY_WITH_GAPS verdict and the review proceeds.

### `REVIEW.example.md`

A copy-pasteable example manifest ships in `context/defaults/REVIEW.example.md` for onboarding
new repos. Run the `initialize-review-context` skill to detect existing docs and generate a
`REVIEW.md` from them.

### Thin POC lanes (deprecated — OCR is the sole engine in v4.3+)

The OCR engine is the sole review path since v4.3.0; the `ocr` toggle was removed in v4.3.1
so OCR runs unconditionally. All review trigger workflows funnel into one OCR-based lane.
The agent lane (`/review`, `/review-serena`) has been removed.

## Development (TypeScript, v4.2+)

The review engine is authored in TypeScript (`opencode-review/src/`) and compiled
to JavaScript (`opencode-review/dist/`) before shipping. `dist/` is committed so
the action runs precompiled JS at runtime — no transpile step, no added latency.

### Contributor workflow

```
# Edit sources
vim opencode-review/src/ocr/compile-ocr-rules.ts

# Typecheck (fast, no emit)
npm run typecheck

# Commit both source and compiled dist together
npm run build
git add opencode-review/src/ opencode-review/dist/
git commit -m "..."
```

### Why `dist/` is committed

This follows the **canonical GitHub Action pattern** (used by `actions/checkout`,
`actions/setup-node`, and most official actions): author in a higher-level
language, precompile, commit the artifact. The action runs the committed JS —
no `tsx`, no `ts-node`, no runtime dependency on TypeScript. Runtime behavior
and latency are identical to the previous `.mjs` source.

### `check-dist` CI guard

`npm run check-dist` rebuilds `dist/` from source and fails if the committed
`dist/` differs. This prevents shipping stale JS when a source change is
committed without a matching `npm run build`. The guard runs in CI on every PR
and push to `main` (`.github/workflows/toolkit-ci.yml`).

### CI pipeline

```
npm ci → npm run typecheck → npm test → npm run build → check-dist
```

Tests run against **compiled `dist/`** (`node --test dist/**/*.test.js`), which
is the truest representation of what ships in the action. `tsx` is allowed for
local dev but never in CI or at action runtime.

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
      - uses: elbertcl/code-review-toolkit/opencode-review@v3.1.0
        with:
          api_key: ${{ secrets.REVIEW_AGENT_API_KEY }}
          model: openrouter/deepseek/deepseek-v4-pro
          use_github_token: true
```

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

## Review triggers (default: always-on-push)

Since 2026-08 the default trigger is auto-review on PR open/synchronize plus the `/review`
comment (see Usage). This replaces the earlier manual-only default. Spend control comes
from the concurrency cancel group and the same-HEAD loop guard; authors avoid mid-iteration
reviews by keeping the PR draft (drafts are skipped).

Manual-only repos: use the slim `issue_comment` workflow documented in Usage.

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

## Model benchmarking

`opencode-review/src/benchmark/` ships a deterministic offline harness:

```bash
npm run build
OCR_LLM_URL=... OCR_LLM_TOKEN=... node opencode-review/dist/benchmark/run-matrix.js \
  opencode-review/src/benchmark/corpus/golden.json \
  --models=deepseek/deepseek-v4-pro,openrouter/qwen-3-coder --repeats=3 \
  --out=docs/plans/$(date +%F)-model-benchmark-results.md
```

It replays the golden corpus (self-contained file sets with expected findings) through the
OCR CLI per model x repeat, scoring anchor-window precision/recall (±5 lines), severity
match, and rule-citation rate. Per-cell failures are recorded as `ERROR` and the matrix
continues. Extend the corpus by adding entries (auto-mine candidates from PR-close outcome
data) to `corpus/golden.json`.

## Versioning

Pin to a tag (`@v1`, `@v1.0.0`) for stability. The tag covers both the action logic and the bundled skills/scripts.

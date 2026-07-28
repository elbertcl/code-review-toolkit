# Serena POC

This fail-open harness evaluates Serena as optional, read-only context for the experimental review lane. It does not make a review quality claim and must not gate or alter control-lane findings.

## Safety contract

- Supply an exact 40-character Serena commit SHA to `scripts/setup-serena.sh`; `uvx --from git+https://github.com/oraios/serena.git@<sha>` resolves that immutable source revision.
- Cache, wrapper, revision, and generated project configuration live under `SERENA_HOME` (default: the user cache directory), outside the tracked repository.
- The wrapper uses planning mode and read-only project configuration. Editing, shell execution, and memory tools are not enabled for the POC.
- Generated, vendor, mock, and `node_modules` paths are excluded.
- The harness removes common provider and GitHub secrets from Serena's environment, bounds execution, and fails open with `available`, `unavailable`, `timed_out`, or `disabled` status.

## Fixed readiness thresholds

| Measurement | Threshold |
|---|---:|
| Samples | at least 20 |
| Availability | at least 95% |
| Fixture compatibility | at least 95% |
| p95 Serena/baseline latency | at most 2.0x |

Run `node poc/serena/summarize.mjs samples.jsonl summary.json`. Frontend fixtures assess tool compatibility only; they are not evidence that Serena improves review quality.

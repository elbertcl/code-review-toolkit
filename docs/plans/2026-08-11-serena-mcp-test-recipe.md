# Serena MCP Verification Recipe

Manual tests to verify Serena MCP is working properly end-to-end. These complement automated unit tests (pure logic) and the probe contract test (`probe.test.sh`).

## 1. Local smoke test

Run the install-and-probe script manually against a real Serena SHA:

```bash
TMPDIR=$(mktemp -d)
SERENA_SHA="<40-char commit SHA from https://github.com/oraios/serena>"
bash opencode-review/serena/install-and-probe.sh "$SERENA_SHA" "$TMPDIR/serena" "$TMPDIR/status.json"
cat "$TMPDIR/status.json" | python3 -m json.tool
```

**Verify:**
- `status` is `available` or `degraded`  
- `schema_version` is `1`
- `cold_start_ms`, `probe_ms`, `deep_probe_ms` are integers
- `revision` matches the SHA you passed
- `deep_probe_status` is `available`

If `status` is `degraded` with reason `help_ok_mcp_unresponsive`, the Serena binary works but MCP server startup failed — check network/DNS.

## 2. MCP round-trip test

Use the spike script against a real repo to verify non-empty output:

```bash
cd /path/to/target-repo
node /path/to/toolkit/opencode-review/dist/context/fetch-serena-context.js \
  "$PWD" \
  /tmp/changed-files.json \
  20 \
  /tmp/serena-context.md
cat /tmp/serena-context.md
```

**Verify:**
- Output is non-empty (if the repo has Go/Python/TypeScript files)
- Output contains symbol names matching the changed files
- Output contains `referenced by:` lines with `path:line` references

## 3. CI integration check

In a PR review workflow run, check the telemetry artifact:

```bash
# Download from the workflow run
gh run download <run-id> -n review-telemetry-<run-id>
cat review-*.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('serena', {}))"
```

**Verify:**
- `serena.status` is `available` 
- The background file (`/tmp/serena-context.md` in the artifact log) contains symbol references

## 4. Fail-open regression test

Set an invalid Serena SHA (e.g., 40 zeros) in the workflow input. The review MUST proceed without Serena — no crash, no workflow failure:

```yaml
with:
  serena_sha: "0000000000000000000000000000000000000000"
```

**Verify:**
- Review completes successfully
- `serena.status` in telemetry is `unavailable`
- Verdict comment shows "Serena: not available"
- No workflow step fails

## 5. Format-change canary

Manually invoke `get_symbols_overview` on a test repo and verify the regex parsers match the output:

```bash
# Run the fetcher with SERENA_DEBUG to capture raw MCP output
SERENA_DEBUG=1 node dist/context/fetch-serena-context.js ...
```

**Verify:**
- The regex at `fetch-serena-context.ts:131` (`/^\s*[-*]\s+`?(\w+)`?/`) matches symbol names
- The regex at `fetch-serena-context.ts:146` (`/^\s*[-*]\s+(\S+:\d+)/`) matches file:line references
- Symbol names are extracted correctly (one per symbol bullet)

# Serena Experimental Integration

The Serena POC remains fail-open and experimental. `scripts/check-serena-setup.sh` emits a small status artifact with one of `available`, `unavailable`, `timed_out`, or `disabled`; `scripts/lib/serena-status.mjs` validates and attaches that status to an experimental analysis artifact.

The reusable workflow defaults `enable_serena` to false and requires `serena_version` to be an exact 40-character commit when enabled. Enabling fails closed unless the pinned toolkit's readiness report says `READY_FOR_ADS_POC` for that exact revision. Analysis runs setup and a credential-free MCP initialize/tool-list health probe before the model, then merges only a healthy generated local Serena MCP command into an isolated OpenCode configuration. Setup or probe failure is fail-open as unavailable or timed out and its status/warning is included in the checksummed artifact and publication metadata.

No source, diff, PR body, review comment, credential, or secret belongs in the Serena status artifact. An unavailable or timed-out Serena process leaves review analysis running with the existing context and records only the status and pinned revision.

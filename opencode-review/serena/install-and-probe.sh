#!/usr/bin/env bash
# .review-poc/serena/install-and-probe.sh
#
# Installs Serena pinned to an exact commit SHA, times the install, captures
# peak RSS, then runs a 30s-timeout MCP health probe. Fail-open: on any
# failure the script writes a status file and exits 0 so the calling
# workflow can continue the review without Serena.
#
# Usage: install-and-probe.sh <SERENA_SHA> <SERENA_HOME> <STATUS_JSON_PATH>

set -uo pipefail

SERENA_SHA="${1:?SERENA_SHA required}"
SERENA_HOME="${2:?SERENA_HOME required}"
STATUS_PATH="${3:?STATUS_PATH required}"

if [[ ! "$SERENA_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "SERENA_SHA must be an exact 40-character commit SHA, got: $SERENA_SHA" >&2
  exit 1
fi

mkdir -p "$SERENA_HOME"
START_MS=$(($(date +%s%N) / 1000000))

# ── Install: fail-open on any error ─────────────────────────────────────
INSTALL_LOG="$SERENA_HOME/install.log"
if command -v /usr/bin/time >/dev/null 2>&1; then
  TIME_CMD=(/usr/bin/time -v)
else
  TIME_CMD=()
fi

if timeout 120s "${TIME_CMD[@]}" env HOME="$SERENA_HOME" XDG_CACHE_HOME="$SERENA_HOME/cache" \
  uvx --from "git+https://github.com/oraios/serena.git@${SERENA_SHA}" serena --help \
  > "$INSTALL_LOG" 2>&1; then
  INSTALL_STATUS="ok"
else
  INSTALL_STATUS="failed"
fi

END_MS=$(($(date +%s%N) / 1000000))
COLD_START_MS=$((END_MS - START_MS))

PEAK_RSS_KB=$(grep -o "Maximum resident set size (kbytes): [0-9]*" "$INSTALL_LOG" 2>/dev/null | grep -o "[0-9]*$" || echo "0")

if [[ "$INSTALL_STATUS" != "ok" ]]; then
  cat > "$STATUS_PATH" <<EOF
{"schema_version":1,"status":"unavailable","reason":"setup_failed","revision":"${SERENA_SHA}","cold_start_ms":${COLD_START_MS},"peak_rss_kb":${PEAK_RSS_KB}}
EOF
  echo "Serena setup failed; review continues without Serena." >&2
  exit 0
fi

# ── Health probe: fail-open on timeout or non-zero exit ─────────────────
mkdir -p "$SERENA_HOME/bin"
cat > "$SERENA_HOME/bin/serena-readonly" <<'WRAPPER'
#!/usr/bin/env bash
exec env HOME="${SERENA_HOME}" XDG_CACHE_HOME="${SERENA_HOME}/cache" \
  uvx --from "git+https://github.com/oraios/serena.git@${SERENA_REVISION}" \
  serena start-mcp-server "$@"
WRAPPER
chmod +x "$SERENA_HOME/bin/serena-readonly"

PROBE_START_MS=$(($(date +%s%N) / 1000000))
if timeout 30s env SERENA_HOME="$SERENA_HOME" SERENA_REVISION="$SERENA_SHA" \
  "$SERENA_HOME/bin/serena-readonly" --help > "$SERENA_HOME/probe.log" 2>&1; then
  PROBE_STATUS="available"
else
  if [[ $? -eq 124 ]]; then
    PROBE_STATUS="timed_out"
  else
    PROBE_STATUS="unavailable"
  fi
fi
PROBE_END_MS=$(($(date +%s%N) / 1000000))

# ── Deep probe: verify MCP server starts and responds ────────────────────
DEEP_STATUS="available"
DEEP_PROBE_MS=0
if [ "$PROBE_STATUS" = "available" ]; then
  DEEP_START=$(($(date +%s%N) / 1000000))
  # Start the MCP server, send an initialize request, check for valid JSON-RPC response
  DEEP_INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'
  if echo "$DEEP_INIT" | timeout 30s env SERENA_HOME="$SERENA_HOME" SERENA_REVISION="$SERENA_SHA" \
    "$SERENA_HOME/bin/serena-readonly" 2>/dev/null | \
    python3 -c "import sys,json; r=json.loads(sys.stdin.readline()); assert 'result' in r" 2>/dev/null; then
    DEEP_STATUS="available"
  else
    DEEP_STATUS="degraded"
  fi
  DEEP_END=$(($(date +%s%N) / 1000000))
  DEEP_PROBE_MS=$((DEEP_END - DEEP_START))
fi
# Use degraded overall status when help passes but MCP fails
FINAL_STATUS="$PROBE_STATUS"
FINAL_REASON="probe_${PROBE_STATUS}"
if [ "$PROBE_STATUS" = "available" ] && [ "$DEEP_STATUS" = "degraded" ]; then
  FINAL_STATUS="degraded"
  FINAL_REASON="help_ok_mcp_unresponsive"
fi

cat > "$STATUS_PATH" <<EOF
{"schema_version":1,"status":"${FINAL_STATUS}","reason":"${FINAL_REASON}","revision":"${SERENA_SHA}","cold_start_ms":${COLD_START_MS},"peak_rss_kb":${PEAK_RSS_KB},"probe_ms":$((PROBE_END_MS - PROBE_START_MS)),"deep_probe_ms":${DEEP_PROBE_MS},"deep_probe_status":"${DEEP_STATUS}"}
EOF

if [[ "$FINAL_STATUS" != "available" ]]; then
  echo "Serena health probe reported ${FINAL_STATUS}; review continues without Serena." >&2
fi
exit 0

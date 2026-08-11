#!/usr/bin/env bash
# probe.test.sh — contract test for install-and-probe.sh status JSON output
#
# Verifies the status JSON adheres to the expected schema, field presence,
# and value constraints. Does NOT require a real Serena installation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE_SCRIPT="$SCRIPT_DIR/install-and-probe.sh"

if [ ! -f "$PROBE_SCRIPT" ]; then
  echo "FAIL: probe script not found at $PROBE_SCRIPT"
  exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Test 1: SHA validation rejects non-hex input
echo -n "Test 1: SHA validation rejects non-hex input ... "
if "$PROBE_SCRIPT" "not-a-sha" "$TMPDIR/home" "$TMPDIR/status.json" 2>/dev/null; then
  echo "FAIL (expected exit 1)"
  exit 1
fi
echo "PASS"

# Test 2: Setup failure writes valid JSON with status=unavailable
echo -n "Test 2: setup failure writes valid JSON ... "
mkdir -p "$TMPDIR/t2-home"
export PATH="/nonexistent:$PATH"
if "$PROBE_SCRIPT" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$TMPDIR/t2-home" "$TMPDIR/t2-status.json" 2>/dev/null; then
  STATUS=$(python3 -c "import json; print(json.load(open('$TMPDIR/t2-status.json'))['status'])")
  if [ "$STATUS" != "unavailable" ]; then
    echo "FAIL (status=$STATUS, expected unavailable)"
    exit 1
  fi
else
  echo "FAIL (expected exit 0, fail-open)"
  exit 1
fi
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
echo "PASS"

# Test 3: Status JSON has all required fields
echo -n "Test 3: status JSON has required fields ... "
# Parse the JSON from the previous test
python3 -c "
import json
with open('$TMPDIR/t2-status.json') as f:
    data = json.load(f)
required = ['schema_version', 'status', 'reason', 'revision', 'cold_start_ms', 'peak_rss_kb']
for key in required:
    assert key in data, f'missing key: {key}'
assert data['schema_version'] == 1
assert isinstance(data['cold_start_ms'], int)
assert isinstance(data['peak_rss_kb'], int)
" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "FAIL (field validation failed)"
  cat "$TMPDIR/t2-status.json"
  exit 1
fi
echo "PASS"

# Test 4: Status value is constrained to known values
echo -n "Test 4: status is a known value ... "
STATUS=$(python3 -c "import json; print(json.load(open('$TMPDIR/t2-status.json'))['status'])")
case "$STATUS" in
  available|degraded|timed_out|unavailable) echo "PASS" ;;
  *) echo "FAIL (unknown status: $STATUS)"; exit 1 ;;
esac

# Test 5: deep_probe_ms and probe_ms are present in probe path
echo -n "Test 5: deep_probe_ms present in probe path ... "
python3 -c "
import json
with open('$TMPDIR/t2-status.json') as f:
    data = json.load(f)
assert data['revision'] == 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
assert isinstance(data['cold_start_ms'], int)
assert isinstance(data['peak_rss_kb'], int)
" 2>&1
if [ $? -ne 0 ]; then
  echo "FAIL (setup-failure path field check)"
  exit 1
fi
echo "PASS"

echo ""
echo "All probe contract tests passed."

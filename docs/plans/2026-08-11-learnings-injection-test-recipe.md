# Learnings Injection Verification Recipe

Manual test to verify resolved-thread reasoning and directives reach OCR in a real PR review cycle.

## 1. Setup

1. Open a PR with a known issue (e.g., an N+1 query in a Go service file)
2. Run `/review` on the PR (triggers a full review via the OCR engine)
3. Confirm the OCR engine flags the issue as an inline comment
4. Reply to the review thread with a reasoning comment explaining the fix (e.g., "Fixed by preloading the association in the controller")
5. Push a commit that fixes the issue
6. Click "Resolve conversation" on the thread (must be resolved BEFORE the next review)

## 2. Re-review

1. Push another commit to the PR (can be a no-op whitespace change)
2. Run `/review` again

## 3. Verify directives

The action writes `/tmp/resolved-directives.json` during the run. Download it from the workflow artifacts (or add a step to upload it as an artifact for verification):

```bash
cat /tmp/resolved-directives.json | python3 -m json.tool
```

**Verify:**
- Contains a directive for the resolved thread's (path, line)
- The directive says "do not re-flag" or equivalent
- Only resolved, non-outdated threads produce directives (unresolved and outdated threads are excluded)

## 4. Verify background

The action writes `/tmp/background.md` containing the budgeted reasoning digest:

```bash
cat /tmp/background.md
```

**Verify:**
- Contains the `human_bodies` reasoning text from the resolved thread ("Fixed by preloading the association")
- Does NOT contain bodies from unresolved threads
- Does NOT contain bodies from outdated threads
- Total output is ≤ 8192 bytes (or ≤ 2000 if Serena context is active)

## 5. Verify suppression

After the re-review completes:

1. Check the PR's inline comments — the resolved finding MUST NOT be re-posted
2. Check the review verdict comment — the `suppressed_as_duplicate` count should be ≥ 1
3. The verdict should say "previously flagged issues suppressed as duplicate"

## 6. Outdated-thread check

1. Push a commit that moves the resolved line (e.g., insert a line above the fix so the line number changes)
2. GitHub marks the thread as "outdated"
3. Run `/review` again

**Verify:**
- The outdated thread is excluded from BOTH directives and background
- The `resolveAnchors` function drops threads where `is_outdated: true` and `line: null`
- No new inline comment is posted at the old anchor

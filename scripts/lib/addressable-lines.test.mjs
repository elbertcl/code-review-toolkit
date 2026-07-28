import assert from "node:assert/strict";
import test from "node:test";

import { parseAddressableLines } from "./addressable-lines.mjs";

test("parses added/context lines on RIGHT and deleted lines on LEFT", () => {
  const diff = `diff --git a/main.go b/main.go
--- a/main.go
+++ b/main.go
@@ -2,2 +2,3 @@
 context
-old
+new
+next
`;
  assert.deepEqual(parseAddressableLines(diff), { "main.go": { LEFT: [2, 3], RIGHT: [2, 3, 4] } });
});

test("handles renames, deletions, and no-newline markers", () => {
  const diff = `diff --git a/old.go b/new.go
similarity index 80%
rename from old.go
rename to new.go
--- a/old.go
+++ b/new.go
@@ -10,2 +10,1 @@
-removed
+kept
\\ No newline at end of file
diff --git a/deleted.go b/deleted.go
deleted file mode 100644
--- a/deleted.go
+++ /dev/null
@@ -1 +0,0 @@
-gone
`;
  assert.deepEqual(parseAddressableLines(diff), {
    "deleted.go": { LEFT: [1], RIGHT: [] },
    "new.go": { LEFT: [10], RIGHT: [10] },
  });
});

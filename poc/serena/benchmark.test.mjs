import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const benchmark = await readFile(new URL("./benchmark.sh", import.meta.url), "utf8");
const setup = await readFile(new URL("../../scripts/setup-serena.sh", import.meta.url), "utf8");

test("benchmark creates the pinned wrapper before checking its availability", () => {
  const setupIndex = benchmark.indexOf('bash "$root/scripts/setup-serena.sh" "$revision"');
  const checkIndex = benchmark.indexOf('bash "$root/scripts/check-serena-setup.sh" "$revision" "$status_file"');

  assert.ok(setupIndex >= 0, "benchmark must initialize the pinned Serena wrapper");
  assert.ok(checkIndex > setupIndex, "benchmark must check the wrapper after setup");
});

test("credential-stripped wrapper keeps Serena state outside the target workspace", () => {
  assert.match(setup, /env -i HOME="\\\$\{SERENA_HOME:-[^}]+\}"/);
  assert.match(setup, /SERENA_HOME="\\\$\{SERENA_HOME:-[^}]+\}"/);
  assert.match(setup, /project_serena_folder_location: "[^"]+projects\/\\\$projectFolderName"/);
  assert.match(setup, /fixed_tools:/);
});

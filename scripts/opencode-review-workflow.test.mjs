import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/opencode-review.yml", import.meta.url);
const actionPath = new URL("../opencode-review/action.yml", import.meta.url);

function runScripts(source) {
  return [...source.matchAll(/^\s+run:\s*(?:\|\n)?([\s\S]*?)(?=^\s+(?:env:|working-directory:|with:|uses:|run:|- name:|- uses:|if:|id:)|\s*$)/gm)].map((match) => match[0]);
}

test("composite action passes its paths and inputs through environment variables", async () => {
  const action = await readFile(actionPath, "utf8");
  for (const script of runScripts(action)) assert.doesNotMatch(script, /\$\{\{/);
  for (const variable of ["ACTION_PATH", "ANALYSIS_INPUT", "OPENCODE_DOWNLOAD_URL", "OPENCODE_SHA256", "OPENCODE_VERSION", "API_KEY_VALUE", "API_KEY_OVERRIDE", "OPENCODE_MODEL", "OPENCODE_VARIANT", "ENABLE_SERENA", "SERENA_VERSION"]) {
    assert.match(action, new RegExp(`${variable}: \\$\\{\\{`));
  }
});

test("reusable workflow passes dynamic run values through environment variables", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  for (const script of runScripts(workflow)) assert.doesNotMatch(script, /\$\{\{/);
  for (const variable of ["TOOLKIT_SHA", "BASE_SHA", "HEAD_SHA", "PREFLIGHT_CHECKSUM", "ANALYSIS_CHECKSUM", "PREFLIGHT_RESULT", "ANALYSIS_RESULT", "PUBLISH_RESULT"]) {
    assert.match(workflow, new RegExp(`${variable}: \\$\\{\\{`));
  }
});

test("reusable workflow preserves the gated job graph and secret boundaries", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  for (const job of ["preflight:", "analysis:", "publish:", "blocked:", "finalize:"]) assert.match(workflow, new RegExp(`^  ${job}`, "m"));
  assert.match(workflow, /analysis:[\s\S]*needs: preflight[\s\S]*needs\.preflight\.outputs\.proceed == 'true'/);
  assert.match(workflow, /publish:[\s\S]*needs: \[preflight, analysis\]/);
  assert.match(workflow, /blocked:[\s\S]*needs: preflight[\s\S]*needs\.preflight\.outputs\.proceed == 'false'/);
  assert.match(workflow, /finalize:[\s\S]*if: always\(\)/);
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  const analysis = workflow.slice(workflow.indexOf("  analysis:"), workflow.indexOf("  publish:"));
  assert.doesNotMatch(preflight, /secrets\.api_key/);
  assert.match(analysis, /API_KEY_VALUE: \$\{\{ secrets\.api_key \}\}/);
  assert.doesNotMatch(analysis, /issues: write|pull-requests: write|GITHUB_TOKEN:\s*\$\{\{/);
});

test("workflow uses an explicit immutable toolkit revision instead of caller workflow_sha", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /toolkit_sha:\s*\{type: string, required: true\}/);
  assert.match(workflow, /repository: elbertcl\/code-review-toolkit(?:\n|\r\n)\s+ref: \$\{\{ inputs\.toolkit_sha \}\}/);
  assert.doesNotMatch(workflow, /code-review-toolkit-v1/);
  assert.doesNotMatch(workflow, /github\.workflow_sha/);
  assert.match(workflow, /validate-toolkit-sha\.mjs/);
});

test("workflow requires immutable OpenCode download inputs and never trusts PATH", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /opencode_download_url:\s*\{type: string, required: true\}/);
  assert.match(workflow, /opencode_sha256:\s*\{type: string, required: true\}/);
  assert.match(workflow, /install-opencode\.mjs/);
  assert.match(workflow, /OPENCODE_EXECUTABLE/);
});

test("workflow pins actions, disables credential persistence, and rejects SHA placeholders", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const uses = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const reference of uses) {
    if (reference.startsWith("./")) continue;
    assert.match(reference, /@[0-9a-f]{40}$/, reference);
    assert.doesNotMatch(reference, /(?:0{40}|1{40}|[a-f0-9]*PLACEHOLDER)/i);
  }
  const checkouts = workflow.split(/uses: actions\/checkout@[0-9a-f]{40}/).slice(1);
  for (const checkout of checkouts) assert.match(checkout.slice(0, 250), /persist-credentials: false/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /EXPECTED_HEAD_SHA/);
});

test("preflight artifact is unconditional, checksummed, unique, non-hidden, and retained one day", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  assert.match(preflight, /if: always\(\)/);
  assert.match(preflight, /preflight-result-(?:\$\{\{ github\.run_id \}\}|\$\{GITHUB_RUN_ID\})\.tar\.gz/);
  assert.match(preflight, /sha256sum/);
  assert.match(preflight, /retention-days: 1/);
  assert.match(preflight, /path: \$\{\{ runner\.temp \}\}\/preflight-result-/);
  assert.doesNotMatch(preflight, /include-hidden-files:\s*true/);
  assert.match(preflight, /preflight_checksum:/);
});

test("analysis runs the local wrapper without a GitHub token and uploads a checksummed result", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const analysis = workflow.slice(workflow.indexOf("  analysis:"), workflow.indexOf("  publish:"));
  assert.match(analysis, /if: \$\{\{ needs\.preflight\.outputs\.proceed == 'true' \}\}/);
  assert.match(analysis, /run-review-analysis\.mjs/);
  assert.match(analysis, /analysis-result-/);
  assert.match(analysis, /sha256sum/);
  assert.match(analysis, /retention-days: 1/);
  assert.doesNotMatch(analysis, /GITHUB_TOKEN:\s*\$\{\{|GH_TOKEN:\s*\$\{\{/);
  assert.doesNotMatch(analysis, /uses: \.\/toolkit\/opencode-review/);
  assert.match(analysis, /install-opencode\.mjs/);
  assert.match(analysis, /node \.\.\/toolkit\/scripts\/run-review-analysis\.mjs/);
});

test("preflight computes addressable lines from the local exact diff", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  assert.match(preflight, /addressable-lines\.mjs/);
  assert.match(preflight, /addressable-lines\.json/);
});

test("publisher validates checksums and finalizer has always semantics", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const publish = workflow.slice(workflow.indexOf("  publish:"), workflow.indexOf("  blocked:"));
  const finalize = workflow.slice(workflow.indexOf("  finalize:"));
  assert.match(publish, /publish-review\.mjs/);
  assert.match(publish, /verify-review-publication\.mjs/);
  assert.match(publish, /sha256sum/);
  assert.match(finalize, /if: always\(\)/);
  assert.match(finalize, /needs\.analysis\.result/);
  assert.match(finalize, /needs\.publish\.result/);
  assert.match(finalize, /incomplete/);
  assert.match(publish, /extract-checked-tar\.mjs/);
  assert.match(publish, /prepare-publication-inputs\.mjs/);
  assert.doesNotMatch(publish, /createHash|arf_/);
  assert.match(finalize, /post-issue-comment\.mjs/);
  assert.doesNotMatch(finalize, /curl/);
});

test("preflight executes pinned toolkit code from an isolated checkout and transiently authenticates commit fetches", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  assert.match(preflight, /repository: elbertcl\/code-review-toolkit/);
  assert.match(preflight, /ref: \$\{\{ inputs\.toolkit_sha \}\}/);
  assert.match(preflight, /path: .*toolkit/);
  assert.match(preflight, /working-directory: consumer/);
  assert.match(preflight, /REVIEW_WORKSPACE:.*consumer/);
  assert.match(preflight, /node \.\.\/toolkit\/scripts\/run-review-gate\.mjs/);
  assert.doesNotMatch(preflight, /run: node scripts\/run-review-gate\.mjs/);
  assert.match(preflight, /http\.extraheader/);
  assert.match(preflight, /git merge-base/);
});

test("re-review state is reconstructed before a filtered diff is built from diff_base", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  assert.ok(preflight.indexOf("prepare-review-state.mjs") < preflight.indexOf("review.diff"));
  assert.match(preflight, /build-review-diff\.mjs/);
});

test("same-head state terminates before analysis with a sanitized skip result", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  assert.match(preflight, /skip_reason/);
  assert.match(preflight, /already reviewed/);
  assert.ok(preflight.indexOf("prepare-review-state.mjs") < preflight.indexOf("build-review-diff.mjs"));
  assert.match(preflight, /proceed=false/);
});

test("Serena activation validates the pinned toolkit readiness report", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /readiness-report\.md/);
  assert.match(workflow, /prepare-serena\.mjs[^\n]*readiness-report\.md/);
});

test("finalizer does not comment for concurrency cancellation and blocked content has a fallback", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  const finalize = workflow.slice(workflow.indexOf("  finalize:"));
  assert.match(preflight, /fallback blocked result/);
  assert.match(finalize, /cancelled/);
});

test("workflow fails closed after blocked context and paginates publication comments", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /context_status.*BLOCKED[\s\S]*proceed=false/);
  assert.match(workflow, /per_page=100/);
  assert.match(workflow, /rel="next"|--paginate/);
});

test("preflight reconstructs live review state and archives from one working directory", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  preflight:"), workflow.indexOf("  analysis:"));
  assert.match(preflight, /prepare-review-state\.mjs/);
  assert.match(preflight, /GITHUB_TOKEN/);
  assert.doesNotMatch(preflight, /"prior_findings":\[\],"known_threads":\[\]/);
  const archiveStep = preflight.slice(preflight.indexOf("- name: Archive preflight result"), preflight.indexOf("- name: Upload preflight result"));
  assert.equal([...archiveStep.matchAll(/working-directory:/g)].length, 1);
});

test("blocked job verifies and extracts the artifact before publishing its sanitized comment", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const blocked = workflow.slice(workflow.indexOf("  blocked:"), workflow.indexOf("  finalize:"));
  assert.match(blocked, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(blocked, /sha256sum/);
  assert.match(blocked, /extract-checked-tar\.mjs/);
  assert.match(blocked, /post-issue-comment\.mjs/);
  assert.match(blocked, /blocked-comment\.md/);
});

test("analysis carries reconstructed known threads into publication", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const analysis = workflow.slice(workflow.indexOf("  analysis:"), workflow.indexOf("  publish:"));
  const publish = workflow.slice(workflow.indexOf("  publish:"), workflow.indexOf("  blocked:"));
  assert.match(analysis, /review-state\.json/);
  assert.match(analysis, /knownThreads:r\.known_threads/);
  assert.match(publish, /review-state\.json/);
});

test("artifact types have exact extraction contracts and publication archives validation inputs", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /extract-checked-tar\.mjs[^\n]*preflight/);
  assert.match(workflow, /extract-checked-tar\.mjs[^\n]*analysis/);
  assert.match(workflow, /extract-checked-tar\.mjs[^\n]*blocked/);
  const analysis = workflow.slice(workflow.indexOf("  analysis:"), workflow.indexOf("  publish:"));
  for (const name of ["findings.json", "review-state.json", "changed-files.json", "addressable-lines.json"]) assert.match(analysis, new RegExp(name.replace(".", "\\.")));
});

test("overlapping runs cancel and finalizer neither reports superseded cancellation nor misses preflight failure", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /^concurrency:\n  group:.*pull_request/m);
  assert.match(workflow, /cancel-in-progress: true/);
  const finalize = workflow.slice(workflow.indexOf("  finalize:"));
  assert.match(finalize, /PREFLIGHT_RESULT.*failure/);
  assert.match(finalize, /cancelled/);
});

test("analysis integrates fail-open Serena with exact pinning and credential isolation", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /enable_serena:\s*\{type: boolean, required: false, default: false\}/);
  assert.match(workflow, /serena_version:\s*\{type: string, required: false, default: ''\}/);
  assert.match(workflow, /serena-status\.json/);
  assert.match(workflow, /addSerenaStatus/);
  assert.match(workflow, /setup-serena\.sh/);
  assert.match(workflow, /prepare-serena\.mjs/);
  assert.match(workflow, /serena_home="\$RUNNER_TEMP\/serena"/);
  assert.match(workflow, /ENABLE_SERENA/);
  assert.doesNotMatch(workflow, /isolated_analysis_disables_external_mcp/);
});

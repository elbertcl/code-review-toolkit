import { execFileSync } from "node:child_process";

import { verifyOpenCodeVersion } from "./validate-runtime.mjs";

await verifyOpenCodeVersion(process.argv[2], async () => execFileSync(process.argv[3] ?? "opencode", ["--version"], { encoding: "utf8" }));

import { execFileSync } from "node:child_process";

import { validateToolkitSha } from "./validate-runtime.mjs";

const expected = validateToolkitSha(process.argv[2]);
const actual = execFileSync("git", ["-C", process.argv[3], "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actual !== expected) throw new Error(`toolkit checkout mismatch: expected ${expected}, found ${actual}`);

import { resolveProviderEnv } from "./lib/provider-env.mjs";

try {
  process.stdout.write(`${resolveProviderEnv(process.argv[2], process.argv[3])}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

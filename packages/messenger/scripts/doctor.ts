import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkClaude } from "../src/index.js";

const isolated = join(homedir(), ".claude-orca");
const health = await checkClaude({
  configDir: existsSync(isolated) ? isolated : undefined,
});

const mark = (ok: boolean | undefined) => (ok ? "✅" : "❌");
console.log(`${mark(health.installed)} installed      ${health.version ?? ""}`);
console.log(`${mark(health.loggedIn)} logged in`);
console.log(`${mark(health.onSubscription)} on subscription`);
console.log(
  `${health.apiKeyInEnv ? "⚠️ " : "✅"} API key in env  ${health.apiKeyInEnv ? "(stripped by the messenger unless useApiKey: true)" : "none"}`,
);
if (health.error) console.log(`\nerror: ${health.error}`);

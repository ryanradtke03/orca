import type { CliMessengerOptions } from "../../types.js";

/**
 * Environment for the claude process.
 *
 * In print mode (-p), Claude Code ALWAYS uses ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN if they're
 * set, instead of your Pro/Max login. Strip them by default so runs use your subscription.
 */
export function buildEnv(
  opts: CliMessengerOptions,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (!opts.useApiKey) {
    delete env["ANTHROPIC_API_KEY"];
    delete env["ANTHROPIC_AUTH_TOKEN"];
  }
  if (opts.configDir) env["CLAUDE_CONFIG_DIR"] = opts.configDir;
  return env;
}

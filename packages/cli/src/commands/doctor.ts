// `orca doctor` — check the Claude CLI install and login.
// Unlike init's install-only gate, doctor runs the full check (a tiny ping) to confirm
// login and subscription status. Reuses checkClaude() from the messenger.
import { checkClaude } from "@orchestra/messenger";
import { CliError } from "../cli-error.js";

export async function run(_args: string[]): Promise<void> {
  const health = await checkClaude();

  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  const lines = [
    `${mark(health.installed)} Claude CLI installed${health.version ? ` (${health.version})` : ""}`,
  ];

  if (health.installed) {
    lines.push(`${mark(health.loggedIn === true)} logged in`);
    if (health.onSubscription) lines.push("✓ on a subscription plan");
    if (health.apiKeyInEnv) lines.push("· ANTHROPIC_API_KEY is set in this environment");
  }
  if (health.error) lines.push(`  ${health.error}`);
  console.log(lines.join("\n"));

  // Non-zero exit when something's wrong, so scripts can gate on `orca doctor`.
  if (!health.installed || health.loggedIn === false) {
    throw new CliError("Claude is not ready — install it and run `claude` once to log in.");
  }
}

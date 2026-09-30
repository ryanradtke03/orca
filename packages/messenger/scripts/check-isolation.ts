// Run: pnpm tsx packages/messenger/scripts/check-isolation.ts
// Compares your normal Claude Code setup with the isolated ~/.claude-orca config.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { collect, createMessenger } from "../src/index.js";

const configDir = join(homedir(), ".claude-orca");
if (!existsSync(configDir)) {
  console.error(
    `No ${configDir} yet. Run once:  CLAUDE_CONFIG_DIR=~/.claude-orca claude   (log in, then exit)`,
  );
  process.exit(1);
}

// Don't ask for your name: Claude Code can see your OS username / home path, so it can always guess it.
// Ask what personal setup it can see instead.
const PROMPT =
  "Without using any tools: list the names of any custom instructions (CLAUDE.md), memory, skills, " +
  "or MCP servers/connectors available to you in this session. If none, reply exactly: none";

async function probe(label: string, opts: { configDir?: string }) {
  const m = createMessenger({
    backend: "cli",
    defaultModel: "sonnet",
    ...opts,
  });
  const { events, done } = await collect(m.send({ prompt: PROMPT }));

  // The system/init line describes the session Claude Code started
  const init = events.find(
    (e) =>
      e.type === "raw" &&
      (e.msg as { type?: string; subtype?: string })?.subtype === "init",
  );
  const info = (init?.type === "raw" ? init.msg : {}) as {
    cwd?: string;
    tools?: unknown[];
    mcp_servers?: { name?: string; status?: string }[];
    slash_commands?: string[];
    apiKeySource?: string;
  };
  const onSubscription = events.some(
    (e) =>
      e.type === "raw" &&
      (e.msg as { type?: string })?.type === "rate_limit_event",
  );

  console.log(`\n── ${label}`);
  console.log("  reply:         ", done.ok ? done.text : done.error);
  console.log("  cost:          ", `$${done.costUsd?.toFixed(4)}`);
  console.log("  cwd:           ", info.cwd);
  console.log("  tools:         ", info.tools?.length ?? "?");
  console.log("  mcp servers:   ", info.mcp_servers?.length ?? "?", info.mcp_servers?.map((s) => s.name).join(", ") ?? "");
  console.log("  slash commands:", info.slash_commands?.length ?? "?");
  console.log("    sample:      ", info.slash_commands?.filter((c) => c.includes(":") || c.includes("-")).slice(0, 12).join(", ") ?? "");
  console.log("  apiKeySource:  ", info.apiKeySource ?? "(not reported)");
  console.log(
    "  subscription:  ",
    onSubscription ? "yes (rate_limit_event seen)" : "no rate_limit_event",
  );
}

await probe("normal (your personal setup)", {});
await probe("isolated (~/.claude-orca)", { configDir });

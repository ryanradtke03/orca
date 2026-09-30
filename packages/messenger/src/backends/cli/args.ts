import type { ValidRequest } from "../../validate.js";

export interface ArgsOptions {
  strictMcp: boolean;
}

/**
 * Built-in tools to block for talk-only runs. Check the names against the `tools` list in
 * your system/init line, and `claude --help` for whether your version has a cleaner flag.
 */
export const TALK_ONLY_DISALLOWED = [
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
];

/** Turn a validated request into `claude` CLI flags. Pure function. */
export function buildArgs(req: ValidRequest, opts: ArgsOptions = { strictMcp: true }): string[] {
  const args = [
    "-p",
    req.prompt, // print mode: run once, no interactive UI
    "--output-format",
    "stream-json", // one JSON object per line
    "--verbose", // stream-json requires this in print mode
    "--max-turns",
    String(req.maxTurns),
  ];

  if (req.model) args.push("--model", req.model);
  if (req.system) args.push("--append-system-prompt", req.system); // adds to Claude Code's prompt, doesn't replace it
  if (req.resume) args.push("--resume", req.resume);

  // Only use MCP servers passed with --mcp-config. We pass none, so account connectors
  // (Gmail, Drive, Notion...) don't load. Verify the flag exists: `claude --help | grep -i mcp`
  if (opts.strictMcp) args.push("--strict-mcp-config");

  if (req.tools.length > 0) {
    args.push("--allowedTools", req.tools.join(","));
    args.push("--permission-mode", "acceptEdits"); // headless: no one is there to approve edits
  } else {
    args.push("--disallowedTools", TALK_ONLY_DISALLOWED.join(","));
  }

  return args;
}

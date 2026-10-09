// Entry point for the orca CLI.
//
// Shape: `orca <command> [positional] [flags]`. argv[2] is the command; the rest
// is handed to each command to parse. Dispatch is wired up incrementally — `help`
// is the only real command for now; the others arrive as stubs in the next sub-step
// and any unrecognised name falls through to usage + exit 1.

import { CliError } from "./cli-error.js";
import { run as describeCommand } from "./commands/describe.js";
import { run as doctorCommand } from "./commands/doctor.js";
import { run as initCommand } from "./commands/init.js";
import { run as listCommand } from "./commands/list.js";
import { run as runCommand } from "./commands/run.js";
import { run as runsCommand } from "./commands/runs.js";

/** Every command handler takes the argv left after the command name. */
type CommandFn = (args: string[]) => void | Promise<void>;

interface CommandDoc {
  name: string;
  /** argument shape shown after the name in help */
  usage: string;
  summary: string;
}

/** The full command surface, from the build plan. Used to render help today and
 *  to drive dispatch as each command is implemented. */
const COMMANDS: CommandDoc[] = [
  {
    name: "init",
    usage: "[--base <ref>] [--github [--remote <name>]] [--yes] [--force]",
    summary: "Write a per-repo .orca.json config",
  },
  { name: "list", usage: "", summary: "List available recipes and chains" },
  { name: "describe", usage: "<recipe>", summary: "Print a recipe's input schema" },
  {
    name: "run",
    usage: "<recipe> [--set k=v]... [--input-json '<json>'] [--base <ref>]",
    summary: "Run a recipe or chain and stream its events",
  },
  { name: "doctor", usage: "", summary: "Check the Claude CLI install and login" },
  { name: "runs", usage: "[--limit <n>]", summary: "List past runs from the trace dir" },
  { name: "help", usage: "[command]", summary: "Show this help" },
];

const GLOBAL_FLAGS: { flag: string; summary: string }[] = [
  { flag: "--repo <path>", summary: "target repo to work in (default: cwd)" },
  { flag: "--config <path>", summary: "explicit config file to load" },
  { flag: "--github", summary: "open a real PR with gh (otherwise a local sink)" },
  { flag: "--json", summary: "machine-readable output" },
];

const COL = 48;
function row(left: string, right: string): string {
  // Pad to COL for alignment, but always leave at least two spaces so an
  // over-long left column never collides with its summary.
  const l = left.length >= COL ? `${left}  ` : left + " ".repeat(COL - left.length);
  return `  ${l}${right}`;
}

/** Print general help, or usage for one command when `topic` names one. */
function printHelp(topic?: string): void {
  if (topic && topic !== "help") {
    const doc = COMMANDS.find((c) => c.name === topic);
    if (!doc) {
      throw new CliError(`unknown command: ${topic}\nRun "orca help" to see available commands.`);
    }
    console.log(`orca ${doc.name} ${doc.usage}`.trimEnd());
    console.log(`  ${doc.summary}`);
    return;
  }

  const lines = [
    "orca — run Orca recipes and chains from the command line",
    "",
    "Usage: orca <command> [args] [flags]",
    "",
    "Commands:",
    ...COMMANDS.map((c) => row(`${c.name} ${c.usage}`.trimEnd(), c.summary)),
    "",
    "Global flags:",
    ...GLOBAL_FLAGS.map((f) => row(f.flag, f.summary)),
  ];
  console.log(lines.join("\n"));
}

/** Command name → handler. help is handled directly in main(). */
const handlers: Record<string, CommandFn> = {
  init: initCommand,
  list: listCommand,
  describe: describeCommand,
  run: runCommand,
  doctor: doctorCommand,
  runs: runsCommand,
};

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  const rest = argv.slice(1);

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    printHelp(rest[0]);
    return;
  }

  const handler = handlers[command];
  if (!handler) {
    throw new CliError(`unknown command: ${command}\nRun "orca help" to see available commands.`);
  }
  await handler(rest);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exit(err.exitCode);
  }
  throw err; // not a user error — surface the real stack for debugging
});

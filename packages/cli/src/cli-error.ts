/**
 * An error with a message meant for the user and a process exit code.
 *
 * Throw this anywhere a command hits a user mistake (bad flag, unknown recipe,
 * a run that failed). The top-level catch in index.ts prints `message` to stderr
 * as a single line and exits with `exitCode` — no stack trace. Anything that is
 * NOT a CliError is treated as a real bug and allowed to surface with its stack.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

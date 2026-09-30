// Git worktree plumbing. Each task attempt gets a fresh worktree on its own
// branch, cut from the repo's current HEAD, so a worker never touches your checkout.
import { execFile } from "node:child_process";
import { appendFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Run a git command in `cwd` and return trimmed stdout. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export interface Worktree {
  path: string;
  branch: string;
}

/** The default location for a run's worktrees, under the (gitignored) .orchestra dir. */
export function worktreeRoot(repo: string, worktreeDir?: string): string {
  return worktreeDir ?? path.join(repo, ".orchestra", "worktrees");
}

/**
 * Create a fresh worktree for one task attempt:
 *   git worktree add -b orca/<run>/<task>-<n> <path> HEAD
 */
export async function createWorktree(
  repo: string,
  runId: string,
  taskId: string,
  attempt: number,
  worktreeDir?: string,
): Promise<Worktree> {
  const branch = `orca/${runId}/${taskId}-${attempt}`;
  const wt = path.join(worktreeRoot(repo, worktreeDir), runId, `${taskId}-${attempt}`);
  await git(repo, ["worktree", "add", "-b", branch, wt, "HEAD"]);
  return { path: wt, branch };
}

export interface Diff {
  patch: string;
  files: string[];
}

/**
 * Stage everything and diff against HEAD, so new files show up too.
 * Returns the patch and the list of changed paths.
 */
export async function getDiff(worktree: string): Promise<Diff> {
  await git(worktree, ["add", "-A"]);
  const patch = await git(worktree, ["diff", "--cached", "HEAD"]);
  const names = await git(worktree, ["diff", "--cached", "--name-only", "HEAD"]);
  const files = names
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return { patch, files };
}

/** Remove a worktree and delete its directory. Never throws. */
export async function removeWorktree(repo: string, worktree: string): Promise<void> {
  try {
    await git(repo, ["worktree", "remove", "--force", worktree]);
  } catch {
    // fall through to a plain rm if git can't
  }
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
}

/** Drop git's records of worktrees whose directories are gone. Never throws. */
export async function pruneWorktrees(repo: string): Promise<void> {
  await git(repo, ["worktree", "prune"]).catch(() => {});
}

/** Remove every worktree for a run at once (used on cancel), then prune. */
export async function removeRunWorktrees(
  repo: string,
  runId: string,
  worktreeDir?: string,
): Promise<void> {
  const dir = path.join(worktreeRoot(repo, worktreeDir), runId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await pruneWorktrees(repo);
}

/**
 * Make sure the repo ignores .orchestra/ even if it isn't in .gitignore, by
 * adding it to .git/info/exclude. Best-effort: never throws.
 */
export async function ensureExcluded(repo: string): Promise<void> {
  const excludePath = path.join(repo, ".git", "info", "exclude");
  try {
    const current = await readFile(excludePath, "utf8").catch(() => "");
    if (current.split("\n").some((line) => line.trim() === ".orchestra/")) return;
    const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
    await appendFile(excludePath, `${prefix}.orchestra/\n`);
  } catch {
    // best effort — a non-standard .git layout just doesn't get the exclude
  }
}

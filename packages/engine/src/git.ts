// Git helpers for chains: commit a diff onto a branch through a throwaway
// worktree, so your checkout and HEAD never move. A chain builds its result
// branch (orca/bug-42) one commit at a time this way.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GitCommitOptions, GitHelpers } from "./types.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

/** True when the ref resolves to a commit. */
async function refExists(repo: string, ref: string): Promise<boolean> {
  try {
    await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The repo's default branch — origin/HEAD when there's a remote, else the branch
 * HEAD currently points at. Used, with main/master, as a branch a commit may
 * never land on. Best-effort: an undetectable default just isn't in the set.
 */
async function defaultBranch(repo: string): Promise<string | null> {
  try {
    const sym = await git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return sym.replace(/^origin\//, "") || null;
  } catch {
    try {
      return (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])) || null;
    } catch {
      return null;
    }
  }
}

const ORCA_BRANCH = /^orca\//;

export interface GitHelperOptions {
  /** How a branch is pushed; the PR sink supplies this. Without it, push refuses. */
  push?: ((branch: string) => Promise<void>) | undefined;
}

export function createGitHelpers(repo: string, opts: GitHelperOptions = {}): GitHelpers {
  async function assertUnprotected(branch: string): Promise<void> {
    const protectedBranches = new Set(["main", "master"]);
    const def = await defaultBranch(repo);
    if (def) protectedBranches.add(def);
    if (protectedBranches.has(branch)) {
      throw new Error(`refusing to commit to protected branch "${branch}"`);
    }
  }

  return {
    async commit(branch: string, commit: GitCommitOptions): Promise<string> {
      await assertUnprotected(branch);

      // 1. create the branch if it's new, cut from `from` (or HEAD).
      if (!(await refExists(repo, branch))) {
        await git(repo, ["branch", branch, commit.from ?? "HEAD"]);
      }

      // 2. a throwaway worktree on the branch, so the real checkout never moves.
      const wt = await mkdtemp(path.join(tmpdir(), "orca-commit-"));
      await rm(wt, { recursive: true, force: true });
      await git(repo, ["worktree", "add", wt, branch]);

      try {
        // 3. apply the diff (loudly if it doesn't apply), then commit as orca.
        const patch = path.join(wt, ".orca-patch.diff");
        await writeFile(patch, ensureTrailingNewline(commit.diff));
        await git(wt, ["apply", "--index", patch]);
        await rm(patch, { force: true });
        await git(wt, [
          "-c",
          "user.name=orca",
          "-c",
          "user.email=orca@users.noreply.github.com",
          "commit",
          "--no-verify",
          "-m",
          commit.message,
        ]);
        return await git(wt, ["rev-parse", "HEAD"]);
      } finally {
        // 4. remove the worktree whatever happened (keep the branch + its commit).
        await git(repo, ["worktree", "remove", "--force", wt]).catch(() => {});
        await rm(wt, { recursive: true, force: true }).catch(() => {});
      }
    },

    async push(branch: string): Promise<void> {
      if (!ORCA_BRANCH.test(branch)) {
        throw new Error(`refusing to push "${branch}": only orca/* branches are pushed`);
      }
      if (!opts.push) throw new Error("no push configured (the PR sink supplies it)");
      await opts.push(branch);
    },
  };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

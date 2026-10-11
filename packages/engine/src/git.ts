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

/** True when a local branch, or a remote-tracking one on any remote, has this name. */
async function branchTaken(repo: string, name: string): Promise<boolean> {
  const refs = await git(repo, [
    "for-each-ref",
    "--format=%(refname)",
    `refs/heads/${name}`,
    `refs/remotes/*/${name}`,
  ]);
  return refs !== "";
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

      // 1. create the branch if it's new, cut from `from` (or HEAD). `from` means
      // "start a branch", so an existing one is an error, not something to stack on:
      // it's left from an earlier run (maybe an open PR) and a push would overwrite it.
      if (await refExists(repo, branch)) {
        if (commit.from !== undefined) {
          throw new Error(
            `branch "${branch}" already exists; start new work on an unused branch (unusedBranch)`,
          );
        }
      } else {
        await git(repo, ["branch", branch, commit.from ?? "HEAD"]);
      }

      // 2. a throwaway worktree on the branch, so the real checkout never moves.
      const wt = await mkdtemp(path.join(tmpdir(), "orca-commit-"));
      await rm(wt, { recursive: true, force: true });
      await git(repo, ["worktree", "add", wt, branch]);

      try {
        // 3. apply the diff (loudly if it doesn't apply), then commit as the repo's
        // own git identity.
        const patch = path.join(wt, ".orca-patch.diff");
        await writeFile(patch, ensureTrailingNewline(commit.diff));
        await git(wt, ["apply", "--index", patch]);
        await rm(patch, { force: true });
        await git(wt, [...(await identityArgs(wt)), "commit", "--no-verify", "-m", commit.message]);
        return await git(wt, ["rev-parse", "HEAD"]);
      } finally {
        // 4. remove the worktree whatever happened (keep the branch + its commit).
        await git(repo, ["worktree", "remove", "--force", wt]).catch(() => {});
        await rm(wt, { recursive: true, force: true }).catch(() => {});
      }
    },

    async unusedBranch(name: string): Promise<string> {
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${name}-${n}`;
        if (!(await branchTaken(repo, candidate))) return candidate;
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

/**
 * Commit as whoever runs orca — the PR opens under their account anyway. Only a
 * repo with no git identity gets a stand-in, and its email is on the reserved
 * .invalid domain: GitHub links a commit to whatever account owns its email, so a
 * plausible address (orca@users.noreply.github.com belongs to the real user
 * "orca") would credit a stranger.
 */
async function identityArgs(cwd: string): Promise<string[]> {
  const get = (key: string) => git(cwd, ["config", "--get", key]).catch(() => "");
  const [name, email] = await Promise.all([get("user.name"), get("user.email")]);
  return [
    ...(name ? [] : ["-c", "user.name=orca"]),
    ...(email ? [] : ["-c", "user.email=orca@orca.invalid"]),
  ];
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

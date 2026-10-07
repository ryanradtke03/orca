// A GitHub-backed PrSink, driven by the `gh` CLI and `git push`. The engine never
// calls gh directly — a chain opens PRs and comments only through this interface,
// so the local sink can stand in for scenarios.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrOpenInput, PrSink } from "../types.js";

const run = promisify(execFile);

export interface GithubSinkOptions {
  repo: string; // path to the local git repo (for git push)
  remote?: string | undefined; // the remote to push to; default "origin"
}

export function githubSink(opts: GithubSinkOptions): PrSink {
  const cwd = opts.repo;
  const remote = opts.remote ?? "origin";
  const gh = (args: string[]) => run("gh", args, { cwd, maxBuffer: 16 * 1024 * 1024 });

  return {
    async readIssue(n: number): Promise<string> {
      const { stdout } = await gh(["issue", "view", String(n), "--json", "title,body"]);
      const { title, body } = JSON.parse(stdout) as { title: string; body: string };
      return `${title}\n\n${body ?? ""}`.trim();
    },

    async open(pr: PrOpenInput): Promise<{ url: string }> {
      await run("git", ["push", "--force-with-lease", remote, pr.branch], { cwd });
      const args = [
        "pr",
        "create",
        "--base",
        pr.base,
        "--head",
        pr.branch,
        "--title",
        pr.title,
        "--body",
        pr.body,
      ];
      if (pr.draft) args.push("--draft");
      const { stdout } = await gh(args);
      return { url: stdout.trim() };
    },

    async comment(n: number, body: string): Promise<void> {
      await gh(["issue", "comment", String(n), "--body", body]);
    },
  };
}

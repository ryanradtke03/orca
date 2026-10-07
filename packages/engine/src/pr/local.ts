// A file-backed PrSink for scenarios and dry runs: no GitHub, no network. Issues
// are read from <dir>/issues/<n>.md; a PR is written to <dir>/prs/<branch>.md and
// its file:// URL returned; a comment is appended to <dir>/comments/<n>.md.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PrOpenInput, PrSink } from "../types.js";

export interface LocalSinkOptions {
  dir: string; // where issues/, prs/ and comments/ live (e.g. <repo>/.orca)
}

export function localSink(opts: LocalSinkOptions): PrSink {
  const { dir } = opts;
  const issuePath = (n: number) => path.join(dir, "issues", `${n}.md`);
  const prPath = (branch: string) => path.join(dir, "prs", `${branch}.md`);
  const commentPath = (n: number) => path.join(dir, "comments", `${n}.md`);

  return {
    async readIssue(n: number): Promise<string> {
      try {
        return (await readFile(issuePath(n), "utf8")).trim();
      } catch {
        throw new Error(`issue #${n} not found at ${issuePath(n)}`);
      }
    },

    async open(pr: PrOpenInput): Promise<{ url: string }> {
      const file = prPath(pr.branch);
      await mkdir(path.dirname(file), { recursive: true });
      const header = [
        `# ${pr.title}`,
        "",
        `- branch: \`${pr.branch}\``,
        `- base: \`${pr.base}\``,
        `- draft: ${pr.draft}`,
        "",
        "---",
        "",
      ].join("\n");
      await writeFile(file, `${header}${pr.body}\n`);
      return { url: pathToFileURL(file).href };
    },

    async comment(n: number, body: string): Promise<void> {
      const file = commentPath(n);
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${body}\n\n---\n\n`);
    },
  };
}

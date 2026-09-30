import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Trace {
  /** Path of the .jsonl file: Claude's raw stdout, one line per line. Replayable as a fixture. */
  readonly path: string;
  /** Append one raw stdout line. */
  write(line: string): void;
  /** Flush the .jsonl and write a .meta.json next to it (request, args, done, timing). */
  close(meta: Record<string, unknown>): Promise<void>;
}

/** Start a trace for one run: <dir>/<timestamp>-<id>.jsonl (+ .meta.json on close). */
export async function openTrace(dir: string): Promise<Trace> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
  const base = join(dir, `${stamp}-${randomUUID().slice(0, 8)}`);
  const path = `${base}.jsonl`;
  const stream = createWriteStream(path, { flags: "w" });

  return {
    path,
    write(line) {
      stream.write(`${line}\n`);
    },
    async close(meta) {
      await new Promise<void>((resolve, reject) =>
        stream.end((err?: Error | null) => (err ? reject(err) : resolve())),
      );
      await writeFile(
        `${base}.meta.json`,
        `${JSON.stringify(meta, null, 2)}\n`,
      );
    },
  };
}

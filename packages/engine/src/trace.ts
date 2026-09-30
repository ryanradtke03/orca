// Per-run trace: events.jsonl (one event per line) + summary.json (the result),
// written under <traceDir>/<runId>/. All writes go through one promise chain so
// lines never interleave. Best-effort — a failed write never breaks a run.
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngineEvent, RunResult, RunSummary } from "./types.js";

export interface Tracer {
  readonly path: string;
  event(e: EngineEvent): void;
  finish(result: RunResult): Promise<void>;
}

export function createTracer(traceDir: string, runId: string): Tracer {
  const dir = path.join(traceDir, runId);
  const eventsPath = path.join(dir, "events.jsonl");
  const summaryPath = path.join(dir, "summary.json");
  let chain: Promise<unknown> = mkdir(dir, { recursive: true });

  return {
    path: dir,
    event(e) {
      chain = chain.then(() => appendFile(eventsPath, `${JSON.stringify(e)}\n`)).catch(() => {});
    },
    async finish(result) {
      const record = { id: runId, finishedAt: new Date().toISOString(), result };
      chain = chain
        .then(() => writeFile(summaryPath, JSON.stringify(record, null, 2)))
        .catch(() => {});
      await chain;
    },
  };
}

interface RunRecord {
  id: string;
  finishedAt: string;
  result: RunResult;
}

/** Read every run's summary.json under traceDir, newest first. Missing dir → []. */
export async function readRuns(traceDir: string): Promise<RunSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(traceDir);
  } catch {
    return [];
  }

  const runs: RunSummary[] = [];
  for (const id of entries) {
    try {
      const raw = await readFile(path.join(traceDir, id, "summary.json"), "utf8");
      const rec = JSON.parse(raw) as RunRecord;
      runs.push({
        id: rec.id,
        finishedAt: rec.finishedAt,
        status: rec.result.status,
        ok: rec.result.ok,
        costUsd: rec.result.costUsd,
        durationMs: rec.result.durationMs,
        tracePath: rec.result.tracePath,
      });
    } catch {
      // skip a run whose summary is missing or unreadable
    }
  }

  runs.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return runs;
}

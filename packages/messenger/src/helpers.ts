// Everything here depends only on the Messenger interface, so it works with any backend.
import { z } from "zod";
import { MessengerError } from "./errors.js";
import type {
  AbortSignalLike,
  DoneEvent,
  Messenger,
  MessengerEvent,
  MessengerRun,
} from "./types.js";

/** Options shared by the talk-only helpers. */
export interface TalkOptions {
  system?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignalLike | undefined;
}

// ── collect ─────────────────────────────────────────────────────────────────

/** Read a whole run into memory: every event plus the final done. */
export async function collect(
  run: MessengerRun,
): Promise<{ events: MessengerEvent[]; done: DoneEvent }> {
  const events: MessengerEvent[] = [];
  for await (const e of run.events) events.push(e);
  return { events, done: await run.done };
}

// ── ask ─────────────────────────────────────────────────────────────────────

/** One question, one answer, no tools. Never throws: check done.ok. */
export async function ask(
  m: Messenger,
  prompt: string,
  opts: TalkOptions = {},
): Promise<DoneEvent> {
  return m.send({ ...opts, prompt, tools: [], maxTurns: 1 }).done;
}

// ── conversation ────────────────────────────────────────────────────────────

export interface Conversation {
  /** Send the next message. The first call starts a session; later calls resume it. */
  send(text: string): Promise<DoneEvent>;
  /** The current session id (undefined until the first reply). */
  readonly sessionId: string | undefined;
  /** Total cost of every turn so far. */
  readonly costUsd: number;
}

/** Multi-turn chat. The CLI keeps the history; we only carry the session id forward. */
export function conversation(
  m: Messenger,
  opts: TalkOptions = {},
): Conversation {
  let sessionId: string | undefined;
  let costUsd = 0;

  return {
    get sessionId() {
      return sessionId;
    },
    get costUsd() {
      return costUsd;
    },
    async send(text) {
      const done = await m.send({
        prompt: text,
        tools: [],
        maxTurns: 1,
        model: opts.model,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        system: sessionId ? undefined : opts.system, // system prompt only on the first turn
        resume: sessionId,
      }).done;
      if (done.sessionId) sessionId = done.sessionId; // always keep the latest id
      costUsd += done.costUsd ?? 0;
      return done;
    },
  };
}

// ── extractJson ─────────────────────────────────────────────────────────────

/**
 * Pull a JSON value out of a model reply. Handles ```json fences, bare JSON,
 * and JSON with chatter around it. Returns undefined if nothing parses.
 */
export function extractJson(text: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    const inFence = tryParse(fenced[1].trim());
    if (inFence !== undefined) return inFence;
  }

  // Fall back to the outermost {...} or [...]
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const inner = tryParse(trimmed.slice(start, end + 1));
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

// ── askJson ─────────────────────────────────────────────────────────────────

export interface AskJsonOptions extends TalkOptions {
  retries?: number | undefined; // extra attempts after the first (default 2)
}

/** Readable list of what was wrong, to send back to the model. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map(
      (i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`,
    )
    .join("\n");
}

/**
 * Ask for structured output and get back a validated, typed value.
 * Retries inside the same conversation, so Claude sees its own mistake.
 * Throws MessengerError if the run fails or it never returns valid JSON.
 */
export async function askJson<S extends z.ZodType>(
  m: Messenger,
  prompt: string,
  schema: S,
  opts: AskJsonOptions = {},
): Promise<z.infer<S>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema), null, 2);
  const convo = conversation(m, opts);

  let reply = await convo.send(
    `${prompt}\n\nRespond with ONLY a JSON value matching this JSON Schema. No prose, no code fences.\n${jsonSchema}`,
  );

  const attempts = 1 + (opts.retries ?? 2);
  for (let attempt = 1; ; attempt++) {
    if (!reply.ok) {
      throw new MessengerError(
        reply.error?.kind ?? "claude_error",
        reply.error?.message ?? "Run failed",
        reply,
      );
    }

    const value = extractJson(reply.text ?? "");
    let problem: string;
    if (value === undefined) {
      problem = "Your reply was not valid JSON.";
    } else {
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      problem = `Your JSON did not match the schema:\n${describeIssues(parsed.error)}`;
    }

    if (attempt >= attempts) {
      throw new MessengerError(
        "invalid_json",
        `No valid JSON after ${attempts} attempts. Last problem: ${problem}`,
        reply,
      );
    }
    reply = await convo.send(`${problem}\nReturn ONLY the corrected JSON.`);
  }
}

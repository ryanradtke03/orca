# @orchestra/messenger

The layer Orca uses to talk to Claude. It starts Claude Code, streams back what Claude is doing as typed events, and always finishes with exactly one result. Agents and the engine are built on top of it. They never talk to Claude directly.

```ts
import { createMessenger, ask } from "@orchestra/messenger";

const m = createMessenger({ backend: "cli" });
const reply = await ask(m, "Say hi in 3 words.");
console.log(reply.text);
```

- **One method.** A messenger has a single method, `send()`. Everything else is a helper built on top of it.
- **Never throws.** `send()`, `ask()` and `conversation()` report failures as `ok: false` with an error kind. Only `askJson()` throws, because it promises a typed value.
- **Runs on your subscription.** The CLI backend strips API keys from the environment by default, so runs are billed to your Claude Pro/Max plan, not the API.
- **Swappable backends.** Code written against `Messenger` works with the real CLI backend, the `FakeMessenger` used in tests, and future backends such as the Agent SDK.

---

## Contents

1. [Setup](#setup)
2. [Quick start](#quick-start)
3. [Core concepts](#core-concepts)
4. [API reference](#api-reference)
5. [Error handling](#error-handling)
6. [Isolation, billing and cost](#isolation-billing-and-cost)
7. [Traces and fixtures](#traces-and-fixtures)
8. [Testing](#testing)
9. [How it works](#how-it-works)
10. [Adding a backend](#adding-a-backend)
11. [Known limitations](#known-limitations)

---

## Setup

### Requirements

- Node 22+
- [Claude Code](https://code.claude.com) installed and on your `PATH` (`claude --version`)
- A Claude Pro or Max subscription, logged in to Claude Code

### Install

Inside the Orca monorepo, other packages depend on it through the workspace:

```jsonc
// packages/engine/package.json
{ "dependencies": { "@orchestra/messenger": "workspace:*" } }
```

### Create the isolated Claude Code config (recommended, one time)

Orca runs Claude Code with its own config folder, so your personal `CLAUDE.md`, skills and plugins don't leak into agent runs.

```bash
CLAUDE_CONFIG_DIR=~/.claude-orca claude
```

Log in with your **Claude subscription** (not the Console / API key option), run `/status` to confirm, then `/exit`. Then pass the folder to the messenger:

```ts
createMessenger({ backend: "cli", configDir: join(homedir(), ".claude-orca") });
```

### Check your setup

```bash
pnpm --filter @orchestra/messenger claude:check
```

```
✅ installed      2.1.285 (Claude Code)
✅ logged in
✅ on subscription
✅ API key in env  none
```

---

## Quick start

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  createMessenger,
  ask,
  conversation,
  askJson,
} from "@orchestra/messenger";

const m = createMessenger({
  backend: "cli",
  configDir: join(homedir(), ".claude-orca"),
  defaultModel: "sonnet",
});

// One question
const hi = await ask(m, "Say hi in 3 words.");
console.log(hi.ok ? hi.text : hi.error);

// A conversation
const chat = conversation(m, { system: "Answer in one short sentence." });
await chat.send("My favorite color is teal.");
console.log((await chat.send("What's my favorite color?")).text); // "Teal."

// Structured output
const Triage = z.object({
  category: z.enum([
    "real_bug",
    "test_bug",
    "timing",
    "test_data",
    "environment",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
const triage = await askJson(
  m,
  "A test passes alone but fails under parallel load...",
  Triage,
);
console.log(triage.category); // typed

// A worker with tools, streaming what it does
const run = m.send({
  prompt: "Read notes.txt and tell me the secret word.",
  cwd: "/path/to/folder",
  tools: ["Read"],
  maxTurns: 5,
});
for await (const e of run.events) {
  if (e.type === "tool_use") console.log("🔧", e.name, e.input);
  if (e.type === "message") console.log("💬", e.text);
}
const done = await run.done;
console.log(done.ok, done.turns, done.costUsd);
```

---

## Core concepts

### Messenger

Anything with a `send()` method:

```ts
interface Messenger {
  send(req: MessengerRequest): MessengerRun;
}
```

Create one with `createMessenger(config)` and reuse it for the whole app. A messenger holds no per-run state, so it's safe to call `send()` many times, including in parallel.

### Run

`send()` returns a **run** immediately. The work has already started.

```ts
interface MessengerRun {
  events: AsyncIterable<MessengerEvent>; // what Claude is doing, as it happens
  done: Promise<DoneEvent>; // the one final result
}
```

Use it either way:

```ts
// stream it
for await (const e of run.events) {
  /* ... */
}

// or just wait for the end. events don't have to be read
const done = await run.done;
```

Guarantees:

- `done` **always resolves**: on success, failure, timeout, cancellation, a crash, or a missing `claude` binary.
- `done` **never rejects**. Failures are `{ ok: false, error: { kind, message } }`.
- `done` resolves **even if nobody reads `events`**. Unread events are buffered.
- The `done` event appears on the `events` stream **exactly once, last**, then the stream ends.
- `events` can be read **once**.

### Events

| `type`        | Fields                                     | Meaning                                                                             |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `message`     | `text`                                     | Claude said something                                                               |
| `tool_use`    | `id`, `name`, `input`                      | Claude called a tool                                                                |
| `tool_result` | `toolUseId`, `name?`, `output`, `isError?` | the tool's result, matched to its call by id. Text output is flattened to a string. |
| `raw`         | `msg`                                      | anything not mapped yet (session start, rate-limit info, non-JSON lines)            |
| `done`        | see below                                  | the final result                                                                    |

`raw` events are safe to ignore. They're useful for debugging: the `system/init` one describes the session Claude Code started (working folder, tools, MCP servers), and a `rate_limit_event` only appears on subscription logins.

### DoneEvent

```ts
interface DoneEvent {
  type: "done";
  ok: boolean;
  text?: string; // Claude's final answer
  sessionId?: string; // pass as `resume` to continue this conversation
  costUsd?: number; // API-equivalent cost (counts toward subscription usage, not billed)
  turns?: number; // model turns used
  tracePath?: string; // set when traceDir is configured
  error?: { kind: MessengerErrorKind; message: string };
}
```

When a run fails after Claude produced a result (for example a timeout), `text`, `sessionId` and `costUsd` are kept, so you can still see how far it got.

---

## API reference

### `createMessenger(config)`

Creates a messenger. This is the only place that looks at which backend to use.

```ts
function createMessenger(config: MessengerConfig): Messenger;

type MessengerConfig =
  | ({ backend: "cli" } & CliMessengerOptions)
  | ({ backend: "fake" } & FakeMessengerOptions);
```

#### CLI options

| Option             | Default               | Description                                                                                                                      |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `claudePath`       | `"claude"`            | path to the Claude Code binary. Set an absolute path if `claude` isn't on `PATH` (common for apps launched from the macOS Dock). |
| `configDir`        | your normal config    | Claude Code config folder, e.g. `~/.claude-orca`. See [Isolation](#isolation-billing-and-cost).                                  |
| `defaultModel`     | Claude Code's default | used when a request has no `model` (`"sonnet"`, `"haiku"`, `"opus"`)                                                             |
| `defaultTimeoutMs` | `300000` (5 min)      | used when a request has no `timeoutMs`                                                                                           |
| `strictMcp`        | `true`                | load **no** MCP servers, including your claude.ai connectors (Gmail, Drive, Notion…)                                             |
| `traceDir`         | off                   | save every run's raw output and metadata to this folder. See [Traces](#traces-and-fixtures).                                     |
| `useApiKey`        | `false`               | keep `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment (API billing). Off means runs always use your subscription. |

### `messenger.send(request)`

Starts a run. Returns immediately.

```ts
send(req: MessengerRequest): MessengerRun;
```

| Field       | Required                  | Default                        | Description                                                                                               |
| ----------- | ------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `prompt`    | ✅                        |                                | what to ask or do. Must not be empty.                                                                     |
| `tools`     |                           | `[]`                           | tools Claude may use, e.g. `["Read", "Edit", "Grep"]`. Empty means talk-only: built-in tools are blocked. |
| `cwd`       | when `tools` is non-empty | a temp folder for talk-only    | folder Claude works in. Must exist.                                                                       |
| `maxTurns`  |                           | `1` talk-only, `20` with tools | stop after this many model turns (error kind `max_turns`)                                                 |
| `model`     |                           | `defaultModel`                 | model for this run                                                                                        |
| `system`    |                           |                                | extra system instructions, added to Claude Code's own prompt                                              |
| `resume`    |                           |                                | a `sessionId` from an earlier run, to continue that conversation                                          |
| `timeoutMs` |                           | `defaultTimeoutMs`             | kill the run after this long (error kind `timeout`)                                                       |
| `signal`    |                           |                                | an `AbortSignal` to cancel the run (error kind `aborted`)                                                 |

**With tools**, edits are accepted automatically (`--permission-mode acceptEdits`), because nobody is there to approve them. Only give a run the tools it needs, and point `cwd` at a folder it's allowed to change, such as a git worktree.

**Talk-only** runs (`tools` empty, no `cwd`) run in the OS temp folder, so a `CLAUDE.md` in whatever folder you launched from can't influence them.

```ts
const controller = new AbortController();
const run = m.send({
  prompt: "Fix the failing test in tests/checkout.spec.ts",
  cwd: worktreePath,
  tools: ["Read", "Edit", "Grep", "Glob"],
  maxTurns: 25,
  model: "sonnet",
  timeoutMs: 10 * 60_000,
  signal: controller.signal,
});
```

### `collect(run)`

Reads a whole run into memory.

```ts
function collect(
  run: MessengerRun,
): Promise<{ events: MessengerEvent[]; done: DoneEvent }>;
```

```ts
const { events, done } = await collect(m.send({ prompt: "Say ok." }));
```

### `ask(messenger, prompt, options?)`

One question, one answer, no tools, one turn. Never throws.

```ts
function ask(
  m: Messenger,
  prompt: string,
  opts?: TalkOptions,
): Promise<DoneEvent>;

interface TalkOptions {
  system?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

```ts
const done = await ask(m, "Summarize this error in one line: ...", {
  model: "haiku",
});
if (done.ok) console.log(done.text);
```

### `conversation(messenger, options?)`

A multi-turn chat. The CLI keeps the history; the conversation only carries the session id forward. Never throws.

```ts
function conversation(m: Messenger, opts?: TalkOptions): Conversation;

interface Conversation {
  send(text: string): Promise<DoneEvent>; // first call starts a session, later calls resume it
  readonly sessionId: string | undefined;
  readonly costUsd: number; // total across all turns
}
```

`system` is sent on the first turn only, since the session already has it after that.

```ts
const chat = conversation(m, { system: "You are a strict code reviewer." });
await chat.send(diff);
const followUp = await chat.send("Which of those issues is most severe?");
```

### `askJson(messenger, prompt, schema, options?)`

Asks for structured output and returns a value validated by a [Zod](https://zod.dev) schema, fully typed.

```ts
function askJson<S extends z.ZodType>(
  m: Messenger,
  prompt: string,
  schema: S,
  opts?: TalkOptions & { retries?: number }, // retries default: 2
): Promise<z.infer<S>>;
```

How it works:

1. Sends your prompt plus the schema as JSON Schema, asking for JSON only.
2. Pulls JSON out of the reply (bare, in a code fence, or surrounded by text) and validates it.
3. If it's invalid, replies **in the same conversation** with the exact problems (e.g. `- confidence: expected number, received string`) and asks for corrected JSON.
4. Returns the value, or throws after `1 + retries` attempts.

**Throws** `MessengerError` with `kind: "invalid_json"` if it never gets valid JSON, or the run's own error kind (`timeout`, `not_found`, …) if a run fails.

```ts
const Plan = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      goal: z.string(),
      dependsOn: z.array(z.string()),
    }),
  ),
});

try {
  const plan = await askJson(m, `Break this spec into tasks:\n${spec}`, Plan, {
    model: "sonnet",
  });
  for (const t of plan.tasks) console.log(t.id, t.goal);
} catch (err) {
  if (err instanceof MessengerError)
    console.error(err.kind, err.message, err.done?.sessionId);
  else throw err;
}
```

Use `.describe()` on schema fields to guide the model: `reason: z.string().describe("one sentence")`.

### `extractJson(text)`

Finds and parses JSON in a model reply. Returns `undefined` if nothing parses.

````ts
extractJson('Sure!\n```json\n{"a":1}\n```'); // { a: 1 }
extractJson('The answer is {"a":2} ok'); // { a: 2 }
extractJson("no json here"); // undefined
````

### `checkClaude(options?)`

Checks whether Claude Code is ready to use. Accepts the same options as the CLI backend.

```ts
function checkClaude(
  opts?: CliMessengerOptions & { ping?: boolean },
): Promise<ClaudeHealth>;

interface ClaudeHealth {
  installed: boolean;
  version?: string;
  loggedIn?: boolean; // a tiny test prompt succeeded
  onSubscription?: boolean; // a rate_limit_event appeared (subscription logins only)
  apiKeyInEnv: boolean; // ANTHROPIC_API_KEY/AUTH_TOKEN set in this process
  error?: string;
}
```

`ping: false` only runs `claude --version`: instant, no usage, but it can't confirm login. The default sends one tiny Haiku prompt.

```ts
const health = await checkClaude({ ping: false });
if (!health.installed) showSetupScreen(health.error);
```

### `FakeMessenger`

A backend that replays recorded Claude output through the same parsing and validation as the real one. Use it in tests. It never calls Claude.

```ts
new FakeMessenger(options: FakeMessengerOptions);

interface FakeMessengerOptions {
  fixtures: Fixture[] | ((req: MessengerRequest, callIndex: number) => Fixture);
  delayMs?: number;  // pause between lines, to test streaming. Default 0.
  exitCode?: number; // pretend process exit code. Default 0.
}

type Fixture = string /* path to a .jsonl file */ | unknown[] /* the lines as objects */;
```

- Fixtures are used **in order**, one per `send()`. Running out gives `ok: false, kind: "no_result"`.
- `.calls` holds every request received, for assertions.

```ts
const fake = new FakeMessenger({ fixtures: ["fixtures/tools-real.jsonl"] });
const done = await fake.send({
  prompt: "x",
  tools: ["Read"],
  cwd: process.cwd(),
}).done;
expect(fake.calls[0].tools).toEqual(["Read"]);
```

You can also pick a fixture per request:

```ts
new FakeMessenger({
  fixtures: (req) =>
    req.tools?.length
      ? "fixtures/tools-real.jsonl"
      : "fixtures/talk-real.jsonl",
});
```

### `MessengerError`

Thrown by `askJson` only.

```ts
class MessengerError extends Error {
  readonly kind: MessengerErrorKind | "invalid_json";
  readonly done?: DoneEvent; // the last run's result, for cost / session / debugging
}
```

---

## Error handling

Every failure comes back as `done.ok === false` with an `error.kind`:

| `kind`            | What happened                                                                                                                   | What to do                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `invalid_request` | the request was rejected before starting: empty prompt, tools without `cwd`, `cwd` doesn't exist, bad `maxTurns` or `timeoutMs` | fix the request. No usage was spent.                  |
| `not_found`       | the `claude` binary wasn't found                                                                                                | install Claude Code, or set `claudePath`              |
| `spawn`           | the process couldn't start for another reason                                                                                   | read `message`                                        |
| `timeout`         | the run took longer than `timeoutMs` and was stopped                                                                            | raise the timeout, or split the task                  |
| `aborted`         | your `signal` cancelled it                                                                                                      | expected when the user stops a run                    |
| `max_turns`       | Claude hit `maxTurns` before finishing                                                                                          | retry with more turns, or narrow the task             |
| `no_result`       | the process ended without a final result. `message` holds the end of its error output.                                          | read `message`; usually a Claude Code or auth problem |
| `exit_code`       | Claude returned a result but the process exited with an error code                                                              | treat as failed                                       |
| `claude_error`    | Claude Code reported another error                                                                                              | read `message`                                        |
| `invalid_json`    | (`askJson` only) no valid JSON after all retries                                                                                | improve the prompt or schema, or raise `retries`      |

When two reasons apply, the most specific one wins. A cancelled run that also passed its timeout is reported as `aborted`.

```ts
const done = await run.done;
if (!done.ok) {
  switch (done.error?.kind) {
    case "max_turns":
      return retryWith({ maxTurns: 40 });
    case "timeout":
      return markSlow();
    case "aborted":
      return; // user stopped it
    default:
      throw new Error(`${done.error?.kind}: ${done.error?.message}`);
  }
}
```

**Killing:** on timeout or abort the process gets `SIGTERM`, then `SIGKILL` after 5 seconds if it's still running. Only the last 64 KB of error output is kept in memory.

---

## Isolation, billing and cost

### Subscription vs API billing

In print mode, Claude Code **always** uses `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` if they're set, which bills the API instead of your subscription. The CLI backend removes both from the child process environment unless you pass `useApiKey: true`. `claude:check` shows whether you're on the subscription.

`costUsd` is the **API-equivalent** price. On a subscription you aren't billed for it, but runs count toward your plan's usage limits.

### What leaks into a run, and how to stop it

| Source                                                 | Stopped by                                            |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `CLAUDE.md` in the folder you launched from            | talk-only runs use a temp folder automatically        |
| your personal `~/.claude` (CLAUDE.md, skills, plugins) | `configDir: ~/.claude-orca`                           |
| your claude.ai connectors (Gmail, Drive, Notion…)      | `strictMcp: true` (the default)                       |
| your claude.ai account skills                          | not yet (see [Known limitations](#known-limitations)) |
| your OS username / home path                           | can't be hidden. Claude Code sees its environment.    |

Tool-using runs still load the `CLAUDE.md` of their `cwd`. That's intended: a worker editing a repo should follow that repo's conventions.

### Keeping cost down

- Use `defaultModel: "sonnet"` or `"haiku"` for most calls. The default model is usually the most expensive.
- Use the isolated config and strict MCP. Fewer skills and tools means a smaller system prompt on every call.
- The first call in a new setup costs more because Claude Code writes its system prompt to the cache. Later calls read it back cheaply.

---

## Traces and fixtures

### Traces

Set `traceDir` and every run writes two files:

```
.orchestra/runs/
  2026-09-30T18-01-53Z-3f2a91c0.jsonl       ← Claude's raw output, line for line
  2026-09-30T18-01-53Z-3f2a91c0.meta.json   ← request, CLI args, result, exit info, timing
```

`done.tracePath` points to the `.jsonl` file. It's in the same format Claude Code prints, so any trace can be replayed with `FakeMessenger`.

### Recording fixtures

```bash
pnpm --filter @orchestra/messenger record <name> "<prompt>" [--tools Read,Grep] [--max-turns N] [--model sonnet] [--cwd dir]
```

```bash
pnpm --filter @orchestra/messenger record talk-real "say hi in 3 words"
pnpm --filter @orchestra/messenger record tools-real "Read notes.txt and tell me the secret word" --tools Read --max-turns 5
pnpm --filter @orchestra/messenger record max-turns-real "Read every file here one by one" --tools Read,Glob --max-turns 1
```

This saves `fixtures/<name>.jsonl` and `fixtures/<name>.meta.json`. Tool runs without `--cwd` get a throwaway folder containing a harmless `notes.txt`. It uses `~/.claude-orca` if it exists.

### Scrubbing

Recordings are **scrubbed automatically**: your home folder path becomes `/home/user`, your OS username becomes `user`, and email addresses become `user@example.com`. To clean fixtures recorded before this:

```bash
pnpm tsx packages/messenger/scripts/scrub-fixtures.ts
```

Check before committing:

```bash
grep -l -i "<your-username>\|@gmail\|/Users/" packages/messenger/fixtures/*
```

---

## Testing

```bash
pnpm --filter @orchestra/messenger test        # unit + integration tests, no Claude, < 1s
pnpm --filter @orchestra/messenger typecheck
pnpm --filter @orchestra/messenger claude:check
```

| Test file           | Covers                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `normalize.test.ts` | Claude output → events; tool results matched by id; `max_turns` detection; every `*-real.jsonl` recording parses |
| `finalize.test.ts`  | every way a run can end → the right `DoneEvent`                                                                  |
| `run.test.ts`       | `done` always resolves, appears once and last; crashes become failed runs                                        |
| `args.test.ts`      | request validation, defaults, CLI arguments, environment (API keys stripped, config folder)                      |
| `fake.test.ts`      | `FakeMessenger` behaves like the real backend                                                                    |
| `helpers.test.ts`   | `ask`, `conversation`, `extractJson`, `askJson` retries and failure                                              |
| `cli.test.ts`       | the real `CliMessenger` against fake `claude` scripts: success, missing binary, timeout, abort, traces           |

`test/` also contains stand-in `claude` scripts used by `cli.test.ts`:

| Script                  | Behaves like                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `fake-claude.mjs`       | a normal talk-only run                                        |
| `fake-claude-tools.mjs` | a run that reads a file and hits a failing search             |
| `fake-claude-hang.mjs`  | a run that never finishes (`--stubborn` also ignores SIGTERM) |
| `fake-claude-crash.mjs` | a crash with lots of error output and no result               |

### Testing your own code

Write code against the `Messenger` interface, then pass a `FakeMessenger` in tests:

```ts
async function triage(m: Messenger, report: string) {
  return askJson(m, `Classify this failure:\n${report}`, Triage);
}

it("classifies a parallel-only failure as test_data", async () => {
  const fake = new FakeMessenger({
    fixtures: ["fixtures/triage-test-data.jsonl"],
  });
  expect((await triage(fake, report)).category).toBe("test_data");
});
```

### Manual scripts

| Script                               | Uses Claude      | Purpose                                                |
| ------------------------------------ | ---------------- | ------------------------------------------------------ |
| `scripts/doctor.ts` (`claude:check`) | 1 tiny call      | setup health check                                     |
| `scripts/record.ts` (`record`)       | yes              | record a fixture                                       |
| `scripts/scrub-fixtures.ts`          | no               | scrub existing fixtures                                |
| `scripts/check-isolation.ts`         | 2 calls          | compare your normal setup with `~/.claude-orca`        |
| `scripts/check-helpers-real.ts`      | yes              | `ask` / `conversation` / `askJson` against real Claude |
| `scripts/check-tools.ts`             | yes, or `--fake` | watch a tool-using run event by event                  |
| `scripts/check-resume.ts`            | yes              | confirm sessions carry over                            |

---

## How it works

```
send(request)
  │
  ▼
validateRequest ──invalid──▶ done { ok: false, kind: "invalid_request" }
  │
  ▼
buildArgs + buildEnv ──▶ spawnClaude("claude -p … --output-format stream-json")
                               │ stdout lines          │ exit code, stderr, timedOut, aborted
                               ▼                        │
                        parseJsonLines ──▶ trace file  │
                               │                        │
                               ▼                        │
                          normalizer                    │
                         │          │                   │
              message/tool events   result line         │
                         │          │                   │
                         ▼          ▼                   ▼
                       queue      held ──────────▶ finalize ──▶ run.done
                         │                                         │
                         ▼                                         ▼
                    run.events  ◀──────── done pushed last, stream closes
```

- **`createRun`** starts the work immediately and connects it to an async queue, which is why `done` resolves even if nobody reads `events`.
- **The result line is held, not emitted.** `finalize` combines it with how the process exited, so a crash after a result is still reported correctly, and `done` is emitted exactly once.
- **`pumpLines`** (parse → normalize → emit) is shared by the CLI backend and `FakeMessenger`, so replayed runs go through exactly the same code as real ones.

### Files

```
src/
  index.ts              public exports
  types.ts              all public types
  create.ts             createMessenger
  helpers.ts            collect, ask, conversation, extractJson, askJson
  check.ts              checkClaude
  errors.ts             MessengerError
  validate.ts           request validation + defaults
  run.ts, queue.ts      the run object and its async queue
  jsonl.ts              line → JSON
  normalize.ts          Claude message → MessengerEvent
  pipeline.ts           pumpLines (shared by backends)
  trace.ts              trace files
  scrub.ts              remove personal details from recordings
  backends/
    cli/
      index.ts          CliMessenger
      args.ts           CLI flags
      env.ts            environment (API keys, config folder)
      spawn.ts          process, timeout, abort, kill
      finalize.ts       exit info + result → DoneEvent
    fake.ts             FakeMessenger
```

Only what's exported from `index.ts` is public. Everything else can change without breaking other packages.

---

## Adding a backend

To add a backend such as the Claude Agent SDK (API-key billing):

1. **Options + config.** Define `SdkMessengerOptions` in `types.ts` and add `| ({ backend: "sdk" } & SdkMessengerOptions)` to `MessengerConfig`.
2. **The backend.** Create `backends/sdk.ts` with a class that implements `Messenger`. Its `send()` should:
   - call `validateRequest` (same rules for every backend),
   - return `createRun(async (emit) => …)`,
   - feed the SDK's messages through `createNormalizer` (the SDK uses the same message shapes as Claude Code's `stream-json` output; add a `pumpMessages` next to `pumpLines`, since the messages are already objects),
   - map the SDK's errors and cancellation onto `DoneEvent` and the existing error kinds.
3. **Wire it up.** Add `case "sdk"` to `createMessenger`. TypeScript flags the missing case until you do.
4. **Contract tests.** Run the same behavioral tests against every backend (talk-only returns text and a session id, resume keeps context, timeouts give `timeout`, …).

`ask`, `conversation`, `askJson`, `collect` and all engine code keep working unchanged.

---

## Known limitations

- **Child processes on kill.** Killing a run stops `claude` but not processes _it_ started (for example a `pnpm test` launched by the Bash tool). Worker runs will need process-group handling.
- **Account skills.** Skills attached to your claude.ai account still load in the isolated config. Authenticating with a `claude setup-token` token is the likely fix, still to be verified.
- **Talk-only tool list.** Talk-only runs block a fixed list of built-in tools. New tools added to Claude Code later won't be blocked until the list is updated in `backends/cli/args.ts`.
- **`--allowedTools` pre-approves, it doesn't restrict.** With tools enabled, the listed tools are auto-approved; other read-only tools may still be available. Tighten this before running untrusted workers.
- **Long prompts** are passed as a command-line argument. Extremely long prompts may hit OS argument limits and would need to be sent over stdin.
- **Thinking blocks** in Claude's output are currently skipped.

# Session model (working draft)

This is a working map of what a Session *is* — its attributes, statuses, and
actions — cross-referenced against what's already built (`CONTEXT.md`,
`src/shared/ipc-contract.ts`, the engine) versus what's still proposed or
unresolved. Once a term settles, fold it into `CONTEXT.md`'s glossary in its
terse form; this doc is allowed to carry more structure and open questions
than that one does.

## Attributes

**Already tracked** (`Session` in `ipc-contract.ts`):

| Attribute | Notes |
|---|---|
| `id` | |
| `projectId` | which Project the Session belongs to |
| `worktreePath` | the Session's isolated git worktree (ADR-0001) |
| `branch` | the worktree's branch |
| `baseRef` | the commit the branch forked from — what the Diff is compared against |
| `pid` | |
| `status` | see Statuses below |
| `pendingPrompt` | `{ type: 'permission' \| 'input', text }`, set while paused on a prompt |
| `worktreeRemoved` | set once the worktree's actually gone from disk (merge cleanup or explicit discard) |
| `pullRequestUrl` | set when Merge mode = Pull request has opened one; polled until merged |

**Proposed, not yet built.**

These aren't a wishlist — they're already specified in code as renderer-local
**optional ride-along fields** (`SessionMeta`/`SessionDetail`/`FileReviewMeta`
in `renderer/src/mock/placeholder-types.ts` and `renderer/src/view-models/session.ts`,
ticket #49). The mock backend fills them and live (real-IPC) mode omits them, so
today the shipped screens render them only in `dev:mock`. The intended path
(per `placeholder-types.ts`'s own comment) is to **promote each field into the
shared contract as its capture/persistence path lands**, keeping it optional so
"live mode renders degraded, never broken."

What decides how hard each one is to add is *where its data comes from* — which
splits them cleanly in two.

**Group 1 — re-readable from the CLI or git.** These need a *capture path*, not
storage: they can be re-derived on demand or on a poll tick, so they don't
depend on the persistence work in Group 2.

| Field (renderer name) | UI that shows it | Blocks on |
|---|---|---|
| `model` | Inspector "Session" meta row | the CLI reporting which model the process runs (new poll/parse) |
| `tokensUsed` / `tokenLimit` | Inspector token line ("128k / 200k") | the CLI reporting usage per turn |
| `turns` | Inspector meta row | same usage report |
| `additions` / `deletions` / `fileCount` | Home + nav diff-stat column ("+412 −86 · 9 files") | rolling up `getDiff` (already exists) into a summary, cached so Home doesn't re-diff every row |
| `plan` (`PlanStep[]`) | Inspector plan checklist | parsing plan state out of the CLI |
| `transcript` (real, w/ tool calls + permission cards) | the whole chat pane | replacing the stub `transcripts` map (`engine.ts`, which only holds what Orca itself sent) with real `claude logs` parsing |

**Group 2 — Orca-authored, unrecoverable from CLI/git.** These have no source to
re-read from, so they're only as durable as Orca makes them — and `sessions` is
**in-memory only** (ADR-0002: nothing about a Session survives an Orca restart
except the process, rediscovered via Discovery). So every field here is lost on
restart unless Orca **persists sessions and re-links a persisted record to the
rediscovered process** — reconciling on the **CLI session id** (stable), never
the `pid` (the OS can reuse it). That persistence + reconciliation layer doesn't
exist yet and is the real prerequisite for all of Group 2.

| Field | UI that shows it | Notes |
|---|---|---|
| per-file `reviewed` (`FileReviewMeta`) | diff viewer review progress | **not** `FileDiffStatus` (`added`/`modified`/`deleted`/`renamed`, git's per-file status). This is "has the user looked at this file's diff yet" — state keyed on (Session, file). |
| `queuedPrompts` (`QueuedPrompt[]`) | Inspector "Queued prompts" | messages the user has lined up to send; purely Orca-side intent |
| a human title/name | (implied — every row currently keys off the opaque `orca-session-<uuid>` branch) | could be seeded from the initial task once spawn-with-a-task (#44/#45) lands |

**Underneath the time labels: there is no timestamp on a Session today.** The
`activityLabel` ("1m", "31m") and `attentionNote` ("waiting on your reply for
6m") the mockups show are *presentation*, faked in the fixtures. Real ones need
at least `createdAt` and `lastActivityAt` — `createdAt` is trivial for
spawned/discovered sessions, but a meaningful `lastActivityAt` requires the poll
to record *when* a session's state last changed (and, like Group 2, to survive a
restart it must be persisted).

## Statuses

Canonical set, already defined in `CONTEXT.md` and `SessionStatus`:

`idle` · `running` · `waiting-on-permission` · `waiting-on-input` · `done` · `errored` · `stopped`

Resolved during this pass:

- **No `spawning` status.** `spawnSession` is synchronous from Orca's side —
  it returns a `Session` already `idle`. (Commit `294c919`, immediately
  before this branch, fixed a bug where a freshly-spawned Session incorrectly
  came up `running` instead of `idle`.)
- **No `killed` status** — see the open question below.

## Actions

### Lifecycle
- **Spawn** — create a new Session in its own worktree/branch (ADR-0001)
- **Adopt** — point Orca at a Session it didn't find via Discovery
- **Stop / Kill** — ⚠️ open question, see below
- **Merge** — integrate a finished Session's Diff per the Project's Merge
  mode (Manual / Local merge / Pull request). Missing from the original
  draft but already real: `requestMerge`, `MergeMode`, ADR-0002.
- **Discard worktree** — remove the worktree from disk. Only valid once the
  Session is inactive (not `running`/`waiting-on-permission`/
  `waiting-on-input`/`idle`) and not already removed.

### Interaction
- **Send message**
- **Approve / deny** — respond to a permission prompt

### Diff review
- **Mark file reviewed** — new concept, not derived from git
- **Next file**

## Open question: Stop vs. Kill vs. Interrupt

The original draft listed `kill` and `stop` as two separate lifecycle
actions. Cross-checking against the code surfaced a real conflict:

- **Today's code**: `stopSession` calls `adapters.process.stop(pid)`, which
  terminates the process. `RESPONDABLE_STATUSES` explicitly excludes
  `'stopped'` — a stopped Session has no process left to talk to. So the
  *existing* "stop" already behaves like an exit/kill.
- **What was described in conversation**: "stop" should pause the Session in
  place while keeping the process alive and interactive (you can still send
  it a message); "kill" should be the one that ends it for good, like exit.

That second behavior — pause the current turn, keep the process alive,
still respondable — doesn't exist anywhere in the code yet. It's closer to
interrupting the current turn (like Escape mid-turn in the Claude Code CLI)
than to anything currently called "stop." Two ways to resolve this, not yet
decided:

1. Keep `stop`/`stopped` meaning what they mean today (process ends); add a
   new action (e.g. "Interrupt") for the pause-but-alive behavior.
2. Rename today's `stop`/`stopped` to `kill`/`killed` throughout, and
   introduce "stop" fresh for the pause-but-alive behavior.

No code or `CONTEXT.md` changes for this yet — revisit once you've picked a
direction.

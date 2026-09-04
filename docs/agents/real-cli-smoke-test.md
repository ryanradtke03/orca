# Smoke test: real `claude` CLI end-to-end

Manual procedure for exercising Orca's **real** adapters against an installed
`claude` CLI, rather than the fakes used by `engine.test.ts` or the demo build
(`npm run dev:demo`). Neither of those touches the code paths this test does:

| Step | Real adapter exercised | Source |
| --- | --- | --- |
| Spawn a session | `process/real.ts` (`spawnClaude`, via `claude ... --bg`) | `src/main/engine/adapters/process/real.ts` |
| Worktree/branch creation | `git/real.ts` (`createWorktree`) | `src/main/engine/adapters/git/real.ts` |
| Detect + parse a pending prompt | `claude-cli/agent-status.ts` (`claude agents --json --all`) and `claude-cli/prompt-text.ts` (`claude logs`, rendered via `@xterm/headless`) | `src/main/engine/claude-cli/agent-status.ts`, `src/main/engine/claude-cli/prompt-text.ts` |
| Send a message (initial task, reply, or approve/deny) | `process/real.ts` (`respond`, via `claude attach`) | `src/main/engine/adapters/process/real.ts` |
| View the Diff | `git/real.ts` (`getDiff`) → `diff-parser.ts` against real `git diff` output | `src/main/engine/adapters/git/real.ts`, `src/main/engine/adapters/git/diff-parser.ts` |
| Merge (Local merge mode) | `git/real.ts` (`mergeWorktree`) | `src/main/engine/adapters/git/real.ts` |

This is **not** automated and is out of scope for CI (see the originating
issue's "Out of scope") — it needs a real, authenticated `claude` CLI on the
machine running it. It also doesn't drive the UI programmatically (that's
#34's demo-build driver, which uses fakes and can't cover this); a person
clicks through Orca while this doc is followed.

## Prerequisites

- `claude` CLI installed and authenticated (`claude --version` succeeds).
- Node deps installed (`npm install`).

## 1. Set up a scratch repo

Never point this test at the Orca repo itself — a session spawned against it
would be free to edit Orca's own source. Use a disposable repo instead:

```bash
mkdir -p /tmp/orca-smoke-test && cd /tmp/orca-smoke-test
git init
echo "# scratch" > README.md
git add -A && git commit -m "initial commit"
```

## 2. Launch Orca with real adapters

From the Orca repo root:

```bash
npm run dev
```

`npm run dev` (not `npm run dev:demo`) is what wires up the real adapters —
`dev:demo` sets `ORCA_DEMO=1`, which swaps in the fakes.

## 3. Add the scratch repo as a Project

In Orca's UI, click **Add project…** and pick `/tmp/orca-smoke-test` from the
native folder picker.

- **Confirms**: the project is added and shown with no sessions yet.

## 4. Spawn a Session

Click **New session** on the project. Wait for it to appear with status
**Running** (not stuck on an error).

- **Confirms**: `process/real.ts`'s `spawnClaude` successfully ran
  `claude ... --bg` in the scratch repo, parsed the `backgrounded · <id>`
  line, and resolved a `pid` via `claude agents --json --all`.
- **Confirms**: `git/real.ts`'s `createWorktree` ran `git worktree add -b
  orca-session-<uuid>`. Verify directly:
  ```bash
  git -C /tmp/orca-smoke-test worktree list
  ```
  A new worktree and branch should be listed.

## 5. Drive it to a real permission prompt and approve

`spawnSession` starts the CLI bare, with no initial prompt, so the session
comes up **Idle** with a session page whose chat pane has an always-available
message input (#45). Open the session and send it a task that needs tool
permission in the scratch repo — e.g. "Create a file called `hello.txt` with
the text `hello world`" — and wait for the prompt to appear.

- **Confirms**: `process/real.ts`'s `respond` (via `claude attach <id>` over
  node-pty) delivers a message to a session with no captured prompt yet, now
  that `engine.ts`'s `respondToPrompt` no longer requires one for an
  idle/waiting-on-input session.

Confirm the session's status changed to **Waiting · permission** with a
prompt rendered in the chat pane and **Approve**/**Deny** buttons.

- **Confirms**: `agent-status.ts`'s `promptTypeFromStatus` correctly read
  `waitingFor: 'permission prompt'` from `claude agents --json --all` and
  classified it as `'permission'`.
- **Confirms**: `prompt-text.ts`'s `renderScreen` + `extractPromptText`
  correctly rendered `claude logs`' raw terminal output and pulled out the
  dialog box (bounded by the cursor marker `❯` and the box's rule line).
  Read the rendered text in the UI — it should be a legible permission
  dialog, not garbled ANSI or a truncated/wrong fragment.

Click **Approve**.

- **Confirms**: `process/real.ts`'s `respond` opened `claude attach <id>` via
  `node-pty` and delivered the reply. The session should resume (status
  leaves **Waiting · permission**) and the requested tool action should
  actually happen — check that `hello.txt` exists in the worktree:
  ```bash
  git -C /tmp/orca-smoke-test worktree list   # get the worktree path
  ls <worktree-path>/hello.txt
  ```

## 6. View the Diff

Once the session is idle or done, open its **Diff** view.

- **Confirms**: `git/real.ts`'s `getDiff` (tracked diff via `git diff -M
  <baseRef>`, untracked files via `git diff --no-index`) and
  `diff-parser.ts`'s `parseUnifiedDiff` correctly parsed real `git diff`
  output. `hello.txt` should show as a new file with the expected content.

## 7. Set Local merge mode and request the merge

On the project, set the merge-mode dropdown to **Local merge**.

The session needs to reach status **Done** before Orca offers a Merge
button — and, per #41, clicking Orca's own **Stop** button always lands on
**Stopped** instead (permanently unmergeable), even once the CLI itself
considers the session's task finished. Until #41 is fixed, end the session
from a terminal instead of Orca's Stop button:

```bash
claude stop <id>
```

Orca's poll loop picks up the CLI's own outcome (`state: "done"` in `claude
agents --json --all`) and marks the session **Done**, at which point Merge
appears. Click **Merge** on it.

- **Confirms**: `git/real.ts`'s `mergeWorktree` committed any outstanding
  changes in the worktree and ran `git merge --no-ff <branch>` against the
  project's own checkout. Verify:
  ```bash
  cd /tmp/orca-smoke-test
  git log --oneline -5   # merge commit + the session's commit(s)
  cat hello.txt          # merged into the project's working tree
  ```

## 8. Clean up

Stop the session if still running, remove the scratch repo:

```bash
rm -rf /tmp/orca-smoke-test
```

## Diagnosing a drift between the real CLI and Orca's parsing

`agent-status.ts` and `prompt-text.ts` depend on the installed `claude` CLI's
exact output shape. If a step above fails in a way that looks like a parsing
problem (prompt never detected, garbled/empty prompt text, wrong prompt type,
approve/deny doesn't do anything), the CLI's output format has likely moved
out from under Orca's assumptions. To confirm and isolate:

1. **Check the CLI version** — `claude --version`. Compare against what was
   current when `agent-status.ts`/`prompt-text.ts` were last touched
   (`git log -p -- src/main/engine/claude-cli/`).
2. **Capture the raw status JSON** the stuck session produces:
   ```bash
   claude agents --json --all
   ```
   Compare its shape against `AgentStatusEntry` in `agent-status.ts` — in
   particular, `status`, `waitingFor`, and `pid` are the fields
   `promptTypeFromStatus` and the polling loop in `process/real.ts` depend
   on. A renamed field or a new `waitingFor` value that isn't `'permission
   prompt'` (mapped to `'input'` by default) is the most likely drift.
3. **Capture the raw log output** for the stuck session:
   ```bash
   claude logs <session-id> > /tmp/orca-smoke-raw.txt
   ```
   Reproduce `renderScreen`/`extractPromptText` against it in a scratch
   script (both are pure functions, easy to run standalone) and inspect the
   rendered lines. Look specifically for whether the cursor marker (`❯`) and
   rule-line pattern (`RULE_LINE` in `prompt-text.ts`) still match what the
   CLI renders — a changed dialog border character or selection glyph is the
   most likely drift there.
4. **Update the parsers and their unit tests** (`agent-status.test.ts`,
   `prompt-text.test.ts`) to match the new real shape, using the captured
   output as a fixture, then re-run this smoke test.

## Results log

Record each run's outcome below (date, `claude --version`, pass/fail per
step, and what broke if anything).

- **2026-09-03**, `claude --version` 2.1.259 — ran end-to-end. Every real
  adapter in the table above (spawn, worktree creation, permission-prompt
  detection/parsing, approve via attach, diff, local merge) confirmed
  working against the real CLI. Two gaps found in the process, both filed
  and linked from #39:
  - [#40](https://github.com/ryanradtke03/orca/issues/40): Orca's UI has no
    way to give a freshly spawned Session its first task — had to `claude
    attach` outside Orca for step 5.
  - [#41](https://github.com/ryanradtke03/orca/issues/41): Orca's own Stop
    button always marks a session `stopped` rather than deriving `done` from
    the CLI's outcome, so no session can reach Merge through Orca's UI alone
    — had to `claude stop <id>` from a terminal for step 7 instead of
    clicking Stop.
  No drift found between the real CLI's output and what
  `agent-status.ts`/`prompt-text.ts` expect.

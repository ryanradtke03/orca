# Orca

Orca is an Electron desktop app for orchestrating multiple Claude Code CLI sessions from a single place, surfacing each session's status and diff so a user doesn't have to juggle multiple terminal windows.

## Language

**Session**:
A single Claude Code CLI process that Orca is tracking, tied to a working directory. Orca can either spawn a Session itself or attach to one the user started independently. A Session's process is independent of the Orca app: it keeps running if Orca quits, and is picked back up through Discovery.
_Avoid_: Agent, run, task, instance

**Project**:
A repository/working directory that one or more Sessions run against. Orca manages multiple Projects at once, each with its own set of Sessions.
_Avoid_: Repo, workspace

**Diff**:
The git diff of the changes a Session has made in its working directory, shown in Orca's UI so the user can review what the session has done.
_Avoid_: Changes, patch

**Session Status**:
The lifecycle state of a Session: Running (actively working), Waiting on permission (paused on a tool-permission prompt), Waiting on input (paused, needs a reply from the user), Idle (process alive, nothing in flight), Done (exited successfully), or Errored (exited/crashed abnormally).

**Permission prompt**:
A pause point where a Session requests the user's approval before running a tool. Orca surfaces these directly in its UI so the user can approve or deny without switching to a terminal.

**Discovery**:
Orca's automatic detection of running Claude Code CLI processes (e.g. via existing session transcripts on disk) so they appear as Sessions without the user taking any action.
_Avoid_: Auto-detect, scan

**Adopt**:
The manual action of pointing Orca at a Session it hasn't found through Discovery, so it starts tracking it.
_Avoid_: Import, link

**Merge mode**:
A per-Project setting controlling how a finished Session's work gets integrated back into the main branch: Manual (the user merges it themselves, outside Orca), Local merge (Orca merges/rebases the worktree branch back directly), or Pull request (Orca opens a PR, for GitHub-hosted Projects).
_Avoid_: Merge strategy, integration mode

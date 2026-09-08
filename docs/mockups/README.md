# Orca UI mockups

Reference screenshots of the approved Orca desktop UI directions. Dark mode only:
body `#0d0d0d`, sidebar `#0a0a0a`, white text, 1px white-alpha hairlines, minimalist
grotesque UI type. Captured at 2x from `Orca Home.dc.html`.

| File | Screen | Notes |
| --- | --- | --- |
| `02a-home-sessions-list.png` | Home / triage | Project sidebar + sessions grouped by project, "Needs you" block pinned at top |
| `02b-home-empty-state.png` | Home / empty | First-run state, no sessions yet |
| `04a-diff-viewer-file-tree.png` | Diff review | Unified hunk view + 250px grouped file tree (folder headers, ✓ reviewed marks, line counts), "← Back to sessions" in header |
| `05b-session-chat-inspector.png` | Session chat | Transcript (user bubbles, agent messages w/ avatar, tool calls, in-thread permission cards), composer with @file + /command, right-hand inspector (plan, files touched, prompt queue) |

## Conventions worth keeping

- Permissions are answered **in-thread**, not in a modal — the request appears as a card in the transcript.
- Triage first: anything blocked on the user surfaces above normal session listing.
- Diff review is a two-pane pattern; the tree tracks review progress, the pane shows unified hunks.
- Session state that isn't conversation (plan, touched files, queued prompts) lives in the right inspector, never inline.

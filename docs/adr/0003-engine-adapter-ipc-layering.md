# Engine/Adapter separation behind an IPC boundary

Orca's core orchestration logic (Session lifecycle, Discovery, Merge mode resolution) needs to be testable without a real Electron window, a real git repository, or the `claude` CLI installed. We decided to isolate all of that decision-making into a single **Engine** module in the main process that never performs real I/O itself; instead it depends on injected **Adapters** (process spawning, git, Discovery scanning, GitHub, notifications, persistence) through interfaces, and is reachable from the renderer only through one explicit public interface exposed over IPC via the preload/contextBridge. This costs an extra layer of indirection but means the Engine can be driven entirely through fakes in tests, and the renderer can never bypass the sanctioned interface to reach raw Node/IPC.

```
Renderer (UI)
   │  window.orca.spawnSession(...) etc.
Preload / contextBridge          ← the public interface, as seen from the UI
   │  IPC (ipcMain.handle / webContents.send)
Main process
   ├─ IPC handlers                — forward renderer calls into the Engine;
   │                                 push Engine events back out
   ├─ Engine                      — Session state machine, Project registry +
   │                                 Merge mode, Discovery logic. Rules only,
   │                                 no real I/O; depends on Adapters via
   │                                 interfaces.
   └─ Adapters                    — Process (spawn/stop `claude`), Git (worktree
                                      add/remove, diff, merge/rebase), Discovery
                                      (scan/read session transcripts), GitHub
                                      (open PR), Notification (OS notify),
                                      Persistence (save/load Orca's own state)
```

A composition root wires the Engine to real Adapters at startup; tests wire the same Engine to fake Adapters instead. Neither the Engine nor the IPC handlers change between the two.

# orca
Claude Agent Orchestrator

## Renderer → Engine pattern

The renderer never talks to Node or IPC directly. It calls a method on
`window.orca`, an API surface exposed by the preload script via
`contextBridge`. That method invokes an IPC channel, which the main process
handles by forwarding the call into the Engine — the rules-only core
described in `docs/adr/0003-engine-adapter-ipc-layering.md`.

```
Renderer            src/renderer/src/main.ts    window.orca.ping()
Preload              src/preload/index.ts        contextBridge.exposeInMainWorld('orca', ...)
Shared contract      src/shared/ipc-contract.ts   IPC_CHANNELS, OrcaApi, PingResult
Main / IPC           src/main/ipc.ts              ipcMain.handle(IPC_CHANNELS.ping, ...)
Composition root      src/main/composition-root.ts  wires the Engine to real Adapters
Engine               src/main/engine/engine.ts    rules only, no real I/O
```

`src/main/composition-root.ts` builds the production Engine with real Adapter
implementations (e.g. `real-persistence-adapter.ts`, backed by a JSON file in
`app.getPath('userData')`) and is what `src/main/index.ts` calls at startup.
Tests instead wire the same `createEngine` to fake adapters (see
`fake-persistence-adapter.ts` and `engine.test.ts`) — the Engine and IPC
handlers never change between the two.

Later tickets that add renderer-callable Engine methods should follow this
same shape: add the method to `Engine`, add its channel/types to
`src/shared/ipc-contract.ts`, handle it in `src/main/ipc.ts`, and expose it
on `window.orca` in `src/preload/index.ts`.

/**
 * Blank black scratch surface for `npm run dev:debug` (ticket: debug frontend).
 *
 * Intentionally empty: this is where you wire up ad-hoc UI to watch the backend
 * (main/engine) as it is rebuilt. It renders on the *real* `window.orca` bridge,
 * so calls here hit the actual IPC/main process, not the mock.
 *
 * Add debug widgets inside the <main> region below. The corner badge only marks
 * that debug mode is active and reports whether the preload bridge is present.
 */
export function DebugScreen(): React.JSX.Element {
  const bridgeReady = typeof window.orca !== 'undefined'

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-primary">
      <div className="pointer-events-none fixed top-2 right-2 z-50 flex items-center gap-2 rounded-[5px] border border-border-soft bg-white/5 px-2 py-1 font-mono text-[10px] text-tertiary">
        <span className="tracking-[0.11em] uppercase">debug</span>
        <span className={bridgeReady ? 'text-diff-add' : 'text-danger'}>
          {bridgeReady ? 'window.orca ✓' : 'no bridge'}
        </span>
      </div>

      <main className="min-h-0 flex-1 overflow-auto">
        {/* Debug output goes here. */}
      </main>
    </div>
  )
}

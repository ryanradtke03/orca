import { activeLaunchMode, type LaunchMode } from '../launch-mode'

// A tone per mode so the fake/synthetic bridges read differently at a glance -
// green for the real production engine, coral for the fixture mock, muted for
// the seeded demo engine.
const MODE_TONE: Record<LaunchMode, string> = {
  live: 'text-diff-add',
  mock: 'text-danger',
  demo: 'text-tertiary'
}

/**
 * A small always-on corner label showing which bridge the app is on
 * (`live` / `mock` / `demo`), mirroring debug mode's `window.orca ✓` badge so
 * it is never ambiguous which backend the UI is talking to.
 */
export function ModeBadge(): React.JSX.Element {
  const mode = activeLaunchMode()
  return (
    <div className="pointer-events-none fixed top-2 right-2 z-50 flex items-center gap-2 rounded-[5px] border border-border-soft bg-white/5 px-2 py-1 font-mono text-[10px] text-tertiary">
      <span className="tracking-[0.11em] uppercase">orca</span>
      <span className={MODE_TONE[mode]}>{mode}</span>
    </div>
  )
}

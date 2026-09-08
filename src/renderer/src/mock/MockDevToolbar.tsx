import { useState } from 'react'
import { getMockControls } from './index'

/**
 * A dev-only control (ticket #49) that flips Home between its populated and
 * empty states with no restart. Rendered only in mock mode; it pins itself to
 * the bottom-right so it stays out of the way of whatever screen is open.
 */
export function MockDevToolbar({ onToggle }: { onToggle: () => void }): React.JSX.Element {
  const [empty, setEmpty] = useState(() => getMockControls().isHomeEmpty())

  function toggle(): void {
    const next = !empty
    getMockControls().setHomeEmpty(next)
    setEmpty(next)
    onToggle()
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-[7px] border border-border-soft bg-panel px-3 py-2 shadow-lg">
      <span className="label-heading">Mock</span>
      <button type="button" className="btn-ghost" onClick={toggle}>
        {empty ? 'Show sessions' : 'Empty Home'}
      </button>
    </div>
  )
}

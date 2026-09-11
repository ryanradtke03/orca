import type { ViewKind } from '@renderer/store/views'
import { useViewStore } from '@renderer/store/views'

const TABS: { key: ViewKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs-you', label: 'Needs you' },
  { key: 'per-project', label: 'This project' },
  { key: 'saved', label: 'Saved' },
  { key: 'preset', label: 'Presets' }
]

/** The dashboard view switcher — each tab is a filter over the session list. */
export function ViewTabs(): React.JSX.Element {
  const { view, setView } = useViewStore()
  return (
    <div className="flex gap-1 border-b border-neutral-800 bg-neutral-950 px-2 py-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setView(t.key)}
          className={`rounded px-2 py-1 text-xs ${
            view === t.key
              ? 'bg-blue-600 text-white'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

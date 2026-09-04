export function EmptyState({ onAddProject }: { onAddProject: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-[520px] text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border-medium">
          <span className="inline-block h-3 w-3 rounded-full bg-accent" />
        </div>
        <h1 className="mt-[26px] text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] text-primary">
          Point Orca at a repository
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-secondary">
          Every Claude Code session you spawn gets its own worktree, and Orca watches all of them from here — status,
          prompts, diffs, in one window.
        </p>
        <div className="mt-[26px] flex justify-center gap-2.5">
          <button type="button" className="btn px-5 py-[11px] text-[12.5px]" onClick={onAddProject}>
            Add project…
          </button>
        </div>
        <div className="mt-[34px] flex justify-center border-t border-border-faint pt-[22px]">
          {[
            { index: '01', desc: 'Pick a repo on disk' },
            { index: '02', desc: 'Spawn a session' },
            { index: '03', desc: 'Approve, review, merge' }
          ].map((step) => (
            <div key={step.index} className="border-r border-border-faint px-5 text-left last:border-r-0">
              <div className="font-mono text-[10.5px] text-faint">{step.index}</div>
              <div className="mt-2 text-[11.5px] leading-[1.45] text-secondary">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

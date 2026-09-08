import type { FileDiff, MergeMode } from '../../../../shared/ipc-contract'
import {
  describeMergeMode,
  formatTokenUsage,
  summarizeFilesTouched,
  type DetailSession,
  type PlanStep,
  type QueuedPrompt
} from '../../session-view'

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="border-t border-border-faint px-4 py-4 first:border-t-0">
      <div className="label-heading pb-3">{label}</div>
      {children}
    </div>
  )
}

function PlanGlyph({ state }: { state: PlanStep['state'] }): React.JSX.Element {
  if (state === 'done') return <span className="text-secondary">✓</span>
  if (state === 'active') return <span className="mt-[5px] inline-block h-[7px] w-[7px] rotate-45 bg-accent" />
  return <span className="text-faint">·</span>
}

function PlanRow({ step }: { step: PlanStep }): React.JSX.Element {
  const textClass =
    step.state === 'active' ? 'text-primary font-medium' : step.state === 'done' ? 'text-secondary' : 'text-faint'
  return (
    <div className="flex items-start gap-2.5 py-[3px]">
      <span className="w-3 flex-none text-center text-[11px] leading-[1.4]">
        <PlanGlyph state={step.state} />
      </span>
      <span className={`text-[12px] leading-[1.4] ${textClass}`}>{step.text}</span>
    </div>
  )
}

function FilesTouched({ files, session }: { files: FileDiff[]; session: DetailSession }): React.JSX.Element {
  const summary = summarizeFilesTouched(files, session)
  return (
    <Section label="Files touched">
      <div className="-mt-1 mb-2 flex justify-end font-mono text-[10.5px] text-tertiary">
        {summary.hasChanges ? (
          <span>
            +{summary.totalAdditions} −{summary.totalDeletions}
          </span>
        ) : (
          <span className="text-faint">no changes</span>
        )}
      </div>
      {summary.rows.map((row) => (
        <div key={row.path} className="flex items-center gap-2 py-[3px]">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary">{row.path}</span>
          <span className="flex-none font-mono text-[10.5px] text-tertiary">+{row.additions}</span>
        </div>
      ))}
      {summary.moreCount > 0 && (
        <div className="flex items-center gap-2 py-[3px]">
          <span className="min-w-0 flex-1 font-mono text-[11px] text-faint">{summary.moreCount} more</span>
          <span className="flex-none font-mono text-[10.5px] text-tertiary">+{summary.moreAdditions}</span>
        </div>
      )}
    </Section>
  )
}

function QueuedPromptCard({ prompt }: { prompt: QueuedPrompt }): React.JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-border-medium px-3 py-2.5 text-[11.5px] leading-relaxed">
      <span className="text-secondary">“{prompt.text}”</span>
      {prompt.note && <span className="text-faint"> — {prompt.note}</span>}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-[3px]">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="font-mono text-[11px] text-secondary">{value}</span>
    </div>
  )
}

export function Inspector({
  session,
  files,
  mergeMode
}: {
  session: DetailSession
  files: FileDiff[]
  mergeMode?: MergeMode
}): React.JSX.Element {
  const plan = session.plan ?? []
  const queuedPrompts = session.queuedPrompts ?? []
  const tokens = formatTokenUsage(session.tokensUsed, session.tokenLimit)
  const meta: { label: string; value: string }[] = [
    session.model ? { label: 'model', value: session.model } : null,
    tokens ? { label: 'tokens', value: tokens } : null,
    session.turns !== undefined ? { label: 'turns', value: String(session.turns) } : null,
    mergeMode ? { label: 'merge', value: describeMergeMode(mergeMode).toLowerCase() } : null
  ].filter((row): row is { label: string; value: string } => row !== null)

  return (
    <aside className="flex w-[300px] flex-none flex-col overflow-y-auto border-l border-border-soft bg-sidebar">
      {plan.length > 0 && (
        <Section label="Plan">
          {plan.map((step, index) => (
            <PlanRow key={index} step={step} />
          ))}
        </Section>
      )}

      <FilesTouched files={files} session={session} />

      {queuedPrompts.length > 0 && (
        <Section label="Queued prompts">
          <div className="flex flex-col gap-2">
            {queuedPrompts.map((prompt, index) => (
              <QueuedPromptCard key={index} prompt={prompt} />
            ))}
          </div>
        </Section>
      )}

      {meta.length > 0 && (
        <Section label="Session">
          {meta.map((row) => (
            <MetaRow key={row.label} label={row.label} value={row.value} />
          ))}
        </Section>
      )}
    </aside>
  )
}

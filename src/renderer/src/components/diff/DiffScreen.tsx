import { useEffect, useState } from 'react'
import type { FileDiff, Session } from '../../../../shared/ipc-contract'
import { describeError } from '../../describe-error'
import { classifyDiffLine, extractDisplayLines, fileDiffAnchorId } from '../../diff-view'
import { FileStats, FileStatusBadge } from './FileStats'

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const DIFF_LINE_CLASSES: Record<string, string> = {
  hunk: 'my-1 bg-[#151514] px-[22px] py-1 text-tertiary',
  add: 'bg-diff-add-bg text-diff-add',
  del: 'bg-diff-del-bg text-diff-del',
  context: 'text-secondary',
  meta: 'text-faint italic'
}

function DiffFile({ file }: { file: FileDiff }): React.JSX.Element {
  const lines = extractDisplayLines(file.diffText)

  return (
    <div id={fileDiffAnchorId(file.path)} className="border-b border-border-soft">
      <div className="sticky top-0 z-[1] flex items-center gap-3 border-b border-border-soft bg-panel-alt px-[22px] py-2.5">
        <span className="min-w-0 flex-1 font-mono text-[11.5px] [overflow-wrap:anywhere] text-primary">{file.path}</span>
        <span className="flex-none font-mono text-[10.5px]">
          <FileStats file={file} />
        </span>
        <FileStatusBadge file={file} />
      </div>
      <div className="overflow-x-auto font-mono text-[11.5px] leading-relaxed whitespace-pre">
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <div key={index} className={`px-[22px] ${DIFF_LINE_CLASSES[classifyDiffLine(line)]}`}>
              {line.length > 0 ? line : ' '}
            </div>
          ))
        ) : (
          <div className="px-[22px] text-faint italic">No preview available</div>
        )}
      </div>
    </div>
  )
}

function totalStats(files: FileDiff[]): string {
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const fileWord = files.length === 1 ? 'file' : 'files'
  return `+${additions} −${deletions} · ${files.length} ${fileWord}`
}

export function DiffScreen({
  sessionId,
  sessions,
  onBack
}: {
  sessionId: string
  sessions: Session[]
  onBack: () => void
}): React.JSX.Element {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setLoadError(null)

    window.orca
      .getDiff(sessionId)
      .then((nextFiles) => {
        if (!cancelled) setFiles(nextFiles)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeError(error))
      })

    return () => {
      cancelled = true
    }
    // Only depends on sessionId, not the `session` object it's looked up from -
    // `sessions` gets a new array (and session objects new identities) on every
    // 2s status poll tick, and re-shelling to `git diff` on every tick would be
    // wasteful. This only re-fetches on a fresh navigation to a session.
  }, [sessionId])

  const backButton = (
    <button type="button" className="btn-ghost" onClick={onBack}>
      ← Back to sessions
    </button>
  )

  if (!session) {
    return (
      <div id="diff-screen" className="flex h-screen w-full">
        <main id="diff-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">{backButton}</div>
          <div className="px-6 py-10 text-[12.5px] leading-relaxed text-faint">
            Failed to load diff: Unknown session: {sessionId}
          </div>
        </main>
      </div>
    )
  }

  if (loadError) {
    return (
      <div id="diff-screen" className="flex h-screen w-full">
        <main id="diff-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">{backButton}</div>
          <div className="px-6 py-10 text-[12.5px] leading-relaxed text-faint">Failed to load diff: {loadError}</div>
        </main>
      </div>
    )
  }

  if (files === null) {
    return (
      <div id="diff-screen" className="flex h-screen w-full">
        <main id="diff-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="px-6 py-10 text-[12.5px] leading-relaxed text-faint">Loading diff…</div>
        </main>
      </div>
    )
  }

  return (
    <div id="diff-screen" className="flex h-screen w-full">
      <aside className="w-[260px] flex-none overflow-y-auto border-r border-border-soft bg-sidebar px-3 py-5">
        <div className="label-heading px-1.5 pb-2">Files</div>
        <div className="flex flex-col gap-px">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              className="flex w-full items-center justify-between gap-2.5 rounded-md px-1.5 py-[7px] text-left hover:bg-hover"
              onClick={() => scrollToId(fileDiffAnchorId(file.path))}
            >
              <span className="min-w-0 flex-1 font-mono text-[11px] leading-tight [overflow-wrap:anywhere] text-secondary">
                {file.path}
              </span>
              <span className="flex-none font-mono text-[9.5px] whitespace-nowrap">
                <FileStats file={file} />
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main id="diff-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
          {backButton}
          <div>
            <div className="font-mono text-[14px] leading-[1.1] text-primary">{session.branch}</div>
            <div className="mt-1.5 font-mono text-[10.5px] text-faint">
              {files.length === 0 ? 'No changes yet' : totalStats(files)}
            </div>
          </div>
        </div>

        <div className="pb-6">
          {files.length > 0 ? (
            files.map((file) => <DiffFile key={file.path} file={file} />)
          ) : (
            <div className="px-6 py-10 text-[12.5px] leading-relaxed text-faint">
              This session hasn&apos;t changed anything yet.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

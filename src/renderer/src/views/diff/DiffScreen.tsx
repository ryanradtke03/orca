import { useEffect, useMemo, useRef, useState } from 'react'
import type { MergeMode, Project, Session } from '../../../../shared/ipc-contract'
import { useDiff } from '../../hooks/useDiff'
import {
  extractDisplayLines,
  fileBasename,
  groupFilesByFolder,
  parseHunks,
  summarizeReview,
  type DiffHunk,
  type DiffRow,
  type ReviewFileDiff
} from '../../view-models/diff'
import { isEditableTarget, stepHunk } from '../../view-models/diff-keys'
import { applyReviewed } from '../../view-models/review'
import { describeMergeMode, describeStatus } from '../../view-models/session'
import { StatusMarker } from '../../components/StatusMarker'

function BackButton({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <button type="button" className="btn-ghost" onClick={onBack}>
      ← Back to sessions
    </button>
  )
}

const LINE_CLASSES: Record<DiffRow['kind'], string> = {
  hunk: 'text-tertiary',
  add: 'bg-diff-add-bg text-diff-add',
  del: 'bg-diff-del-bg text-diff-del',
  meta: 'text-faint italic',
  context: 'text-secondary'
}

/** The single signed stat a file-tree row shows - deletions win when they dominate (a mostly-removed file). */
function dominantStat(file: ReviewFileDiff): React.JSX.Element {
  return file.deletions > file.additions ? (
    <span className="text-diff-del">−{file.deletions}</span>
  ) : (
    <span className="text-diff-add">+{file.additions}</span>
  )
}

function FileTree({
  files,
  selectedPath,
  baseRef,
  onSelect
}: {
  files: ReviewFileDiff[]
  selectedPath: string
  baseRef: string
  onSelect: (path: string) => void
}): React.JSX.Element {
  const groups = groupFilesByFolder(files)
  const review = summarizeReview(files)

  return (
    <aside className="flex w-[260px] flex-none flex-col border-r border-border-soft bg-sidebar">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <span className="label-heading">Files</span>
        <span className="font-mono text-[10px] text-faint">
          {review.reviewed} / {review.total} reviewed
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((group) => (
          <div key={group.folder} className="mb-3">
            {group.folder && <div className="px-1.5 pb-1 font-mono text-[10px] text-faint">{group.folder}</div>}
            <div className="flex flex-col gap-px">
              {group.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-1.5 py-[6px] text-left ${
                    file.path === selectedPath ? 'bg-active' : 'hover:bg-hover'
                  }`}
                  onClick={() => onSelect(file.path)}
                >
                  <span className="w-2.5 flex-none text-center text-[10px] text-secondary">
                    {file.reviewed ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary">
                    {fileBasename(file.path)}
                  </span>
                  <span className="flex-none font-mono text-[9.5px] whitespace-nowrap">{dominantStat(file)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border-faint px-4 py-3.5 font-mono text-[10px] text-faint">
        <span>j / k · next hunk</span>
        <span>a · mark reviewed</span>
        <span>base @ {baseRef}</span>
      </div>
    </aside>
  )
}

function DiffHeader({
  session,
  projectName,
  mergeMode,
  fileCount,
  additions,
  deletions,
  onBack
}: {
  session: Session
  projectName: string
  mergeMode?: MergeMode
  fileCount: number
  additions: number
  deletions: number
  onBack: () => void
}): React.JSX.Element {
  const fileWord = fileCount === 1 ? 'file' : 'files'
  return (
    <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
      <BackButton onBack={onBack} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="w-[11px] flex-none text-center text-[11px] text-primary">
            <StatusMarker status={session.status} />
          </span>
          <span className="truncate font-mono text-[14px] leading-none text-primary">
            {projectName}/{session.branch}
          </span>
          <span className="flex-none rounded border border-border-medium px-[7px] py-[3px] text-[9px] leading-none font-medium tracking-[0.09em] text-secondary uppercase">
            {describeStatus(session.status)}
          </span>
        </div>
        <div className="mt-2 truncate font-mono text-[10.5px] leading-none text-faint">
          +{additions} −{deletions} · {fileCount} {fileWord}
          {mergeMode && ` · merge mode: ${describeMergeMode(mergeMode).toLowerCase()}`}
        </div>
      </div>
      {/* Both header actions are inert for now (ticket #52). */}
      <button type="button" className="btn-ghost px-[15px] py-2 text-[11.5px]">
        Discard worktree
      </button>
      <button type="button" className="btn px-[15px] py-2 text-[11.5px]">
        Open pull request
      </button>
    </div>
  )
}

function ViewControls(): React.JSX.Element {
  // Unified/Split/Whitespace are inert for now (ticket #52).
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-border-medium">
        <span className="bg-active px-2.5 py-[5px] text-[10.5px] text-primary">Unified</span>
        <span className="px-2.5 py-[5px] text-[10.5px] text-faint">Split</span>
      </div>
      <button type="button" className="rounded-md border border-border-medium px-2.5 py-[5px] text-[10.5px] text-secondary hover:border-white/50 hover:text-primary">
        Whitespace
      </button>
    </div>
  )
}

function FileBar({ file }: { file: ReviewFileDiff }): React.JSX.Element {
  const total = Math.max(1, file.additions + file.deletions)
  return (
    <div className="flex items-center gap-4 border-b border-border-soft px-6 py-3">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-primary">{file.path}</span>
      <span className="flex-none font-mono text-[10.5px]">
        <span className="text-diff-add">+{file.additions}</span> <span className="text-diff-del">−{file.deletions}</span>
      </span>
      <span className="flex h-[6px] w-[64px] flex-none overflow-hidden rounded-full bg-white/10">
        <span className="bg-diff-add" style={{ width: `${(file.additions / total) * 100}%` }} />
        <span className="bg-diff-del" style={{ width: `${(file.deletions / total) * 100}%` }} />
      </span>
      <ViewControls />
    </div>
  )
}

function DiffLineRow({ row }: { row: DiffRow }): React.JSX.Element {
  const line = row.newLine ?? row.oldLine
  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '
  const content = row.kind === 'add' || row.kind === 'del' ? row.text.slice(1) : row.text.replace(/^ /, '')
  return (
    <div className={`flex ${LINE_CLASSES[row.kind]}`}>
      <span className="w-[52px] flex-none py-[1px] pr-3 text-right text-faint select-none">{line ?? ''}</span>
      <span className="w-[16px] flex-none py-[1px] text-center select-none">{sign}</span>
      <span className="flex-1 py-[1px] pr-6">{content.length > 0 ? content : ' '}</span>
    </div>
  )
}

function HunkView({
  file,
  hunks,
  activeHunk
}: {
  file: ReviewFileDiff
  hunks: DiffHunk[]
  activeHunk: number
}): React.JSX.Element {
  const hunkRefs = useRef<(HTMLDivElement | null)[]>([])

  // j/k scroll the active hunk to the top of the viewport. Keyed on file.path
  // too so re-selecting a file (which resets activeHunk to 0) scrolls to its top.
  useEffect(() => {
    hunkRefs.current[activeHunk]?.scrollIntoView({ block: 'start' })
  }, [activeHunk, file.path])

  if (hunks.length === 0) {
    // Binary file / pure rename - no line-numbered hunks to render.
    return (
      <div className="overflow-x-auto px-6 py-4 font-mono text-[11.5px] whitespace-pre text-faint italic">
        {extractDisplayLines(file.diffText).join('\n') || 'No preview available'}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto font-mono text-[11.5px] leading-relaxed">
      {hunks.map((hunk, index) => (
        <div
          key={index}
          ref={(el) => {
            hunkRefs.current[index] = el
          }}
        >
          <div className="flex items-center justify-between bg-[#151514] px-6 py-1">
            <span className="text-tertiary">{hunk.header}</span>
            <span className="pr-2 text-[10px] text-faint">
              hunk {index + 1} of {hunks.length}
            </span>
          </div>
          <div className="px-6">
            {hunk.rows.map((row, rowIndex) => (
              <DiffLineRow key={rowIndex} row={row} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DiffFooter({
  fileIndex,
  fileCount,
  reviewed,
  onMarkReviewed,
  onNextFile
}: {
  fileIndex: number
  fileCount: number
  reviewed: boolean
  onMarkReviewed: () => void
  onNextFile: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-t border-border-soft px-6 py-3">
      <span className="font-mono text-[11px] text-faint">
        file {fileIndex + 1} of {fileCount}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`btn-ghost px-[15px] py-2 text-[11.5px] ${reviewed ? 'text-primary' : ''}`}
          onClick={onMarkReviewed}
        >
          {reviewed ? '✓ Reviewed' : 'Mark reviewed'}
        </button>
        <button type="button" className="btn px-[15px] py-2 text-[11.5px]" onClick={onNextFile}>
          Next file →
        </button>
      </div>
    </div>
  )
}

function DiffShell({ onBack, children }: { onBack: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <div id="diff-screen" className="flex h-screen w-full">
      <main id="diff-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
          <BackButton onBack={onBack} />
        </div>
        <div className="px-6 py-10 text-[12.5px] leading-relaxed text-faint">{children}</div>
      </main>
    </div>
  )
}

export function DiffScreen({
  sessionId,
  sessions,
  projects,
  reviewedPaths,
  onBack,
  onToggleReviewed,
  onMarkReviewed
}: {
  sessionId: string
  sessions: Session[]
  projects: Project[]
  reviewedPaths: readonly string[]
  onBack: () => void
  onToggleReviewed: (sessionId: string, path: string) => void
  onMarkReviewed: (sessionId: string, path: string) => void
}): React.JSX.Element {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  // The `reviewed` flag is app-tracked (per session, in App), not part of the
  // diff payload - applyReviewed stamps it onto the loaded files so the tree,
  // counter and Mark-reviewed button all reflect the same source of truth.
  const { files: rawFiles, loadError } = useDiff(sessionId)
  // Memoized so a poll-driven App re-render doesn't re-clone every file object
  // (applyReviewed) and hand the keydown effect below a fresh `files` reference
  // that would tear its listener down and re-add it each render. rawFiles and
  // reviewedPaths are both reference-stable until they actually change.
  const files = useMemo(() => (rawFiles ? applyReviewed(rawFiles, reviewedPaths) : null), [rawFiles, reviewedPaths])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  // Which hunk j/k has scrolled to within the selected file; reset per file below.
  const [activeHunk, setActiveHunk] = useState(0)

  // Reset the selection when navigating to a different session's diff.
  useEffect(() => setSelectedPath(null), [sessionId])

  const selectedIndex = files
    ? Math.max(
        0,
        files.findIndex((file) => file.path === selectedPath)
      )
    : 0
  const selected = files?.[selectedIndex] ?? null
  const hunks = selected ? parseHunks(selected.diffText) : []
  const hunkCount = hunks.length

  // Reset the hunk cursor whenever the shown file changes (tree click, `a`, Next file).
  const selectedFilePath = selected?.path ?? null
  useEffect(() => setActiveHunk(0), [selectedFilePath])

  // The scroll viewport persists across file changes (same DOM node). A file
  // with hunks gets scrolled back to the top by HunkView (scrollIntoView on
  // hunk 0), but a binary / pure-rename file has no hunk ref to scroll to and
  // would otherwise keep the previous file's scroll, hiding its placeholder
  // below the fold - so reset the container here for that case.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (hunkCount === 0 && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [selectedFilePath, hunkCount])

  // j/k move between hunks; a marks the current file reviewed and advances to
  // the next (wrapping, like the Next file button). Guarded so the shortcuts
  // stay dormant while typing in the composer or any other input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'j') {
        event.preventDefault()
        setActiveHunk((current) => stepHunk(current, hunkCount, 1))
      } else if (event.key === 'k') {
        event.preventDefault()
        setActiveHunk((current) => stepHunk(current, hunkCount, -1))
      } else if (event.key === 'a') {
        event.preventDefault()
        if (!files || files.length === 0 || !selected) return
        onMarkReviewed(sessionId, selected.path)
        setSelectedPath(files[(selectedIndex + 1) % files.length].path)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hunkCount, selected, files, selectedIndex, sessionId, onMarkReviewed])

  if (!session) return <DiffShell onBack={onBack}>Failed to load diff: Unknown session: {sessionId}</DiffShell>
  if (loadError) return <DiffShell onBack={onBack}>Failed to load diff: {loadError}</DiffShell>
  if (files === null) return <DiffShell onBack={onBack}>Loading diff…</DiffShell>
  if (files.length === 0) return <DiffShell onBack={onBack}>This session hasn&apos;t changed anything yet.</DiffShell>
  // Unreachable given files.length > 0 - narrows `selected` from the nullable
  // form computed above (before the guards) for the render below.
  if (!selected) return <DiffShell onBack={onBack}>Loading diff…</DiffShell>

  const project = projects.find((candidate) => candidate.id === session.projectId)
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  return (
    <div id="diff-screen" className="flex h-screen w-full">
      <FileTree
        files={files}
        selectedPath={selected.path}
        baseRef={session.baseRef}
        onSelect={setSelectedPath}
      />
      <main id="diff-main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <DiffHeader
          session={session}
          projectName={project?.name ?? session.projectId}
          mergeMode={project?.mergeMode}
          fileCount={files.length}
          additions={additions}
          deletions={deletions}
          onBack={onBack}
        />
        <FileBar file={selected} />
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <HunkView file={selected} hunks={hunks} activeHunk={activeHunk} />
        </div>
        <DiffFooter
          fileIndex={selectedIndex}
          fileCount={files.length}
          reviewed={selected.reviewed ?? false}
          onMarkReviewed={() => onToggleReviewed(sessionId, selected.path)}
          onNextFile={() => setSelectedPath(files[(selectedIndex + 1) % files.length].path)}
        />
      </main>
    </div>
  )
}

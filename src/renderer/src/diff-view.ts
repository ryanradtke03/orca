import type { FileDiff, Session } from '../../shared/ipc-contract'
import { el } from './dom'

/**
 * A file's diffText carries git's own per-file header (`diff --git`, `index`,
 * `---`/`+++`) ahead of the actual hunks - useful for real git tooling, but
 * redundant here since the file's path/status are already shown separately.
 * Trims down to the hunks (or, for a diff with no hunks at all - a binary
 * file, a pure rename - whatever descriptive line git left instead).
 */
export function extractDisplayLines(diffText: string): string[] {
  const lines = diffText.split('\n')
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'))
  if (firstHunkIndex !== -1) return lines.slice(firstHunkIndex)

  return lines.filter((line) => !line.startsWith('diff --git') && !line.startsWith('index '))
}

export type DiffLineKind = 'hunk' | 'add' | 'del' | 'meta' | 'context'

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  if (line.startsWith('\\')) return 'meta'
  return 'context'
}

function fileDiffAnchorId(path: string): string {
  return `diff-file-${path}`
}

function renderDiffLine(line: string): HTMLElement {
  const kind = classifyDiffLine(line)
  return el('div', {
    className: `diff-line diff-line-${kind}`,
    textContent: line.length > 0 ? line : ' '
  })
}

function renderDiffFile(file: FileDiff): HTMLElement {
  const lines = extractDisplayLines(file.diffText)

  return el('div', { className: 'diff-file', id: fileDiffAnchorId(file.path) }, [
    el('div', { className: 'diff-file-header' }, [
      el('span', { className: 'diff-file-path', textContent: file.path }),
      el('span', { className: 'diff-file-stats' }, [
        el('span', { className: 'diff-stat-add', textContent: `+${file.additions}` }),
        ' ',
        el('span', { className: 'diff-stat-del', textContent: `−${file.deletions}` })
      ]),
      el('span', { className: `diff-file-status status-${file.status}`, textContent: file.status })
    ]),
    el(
      'div',
      { className: 'diff-file-body' },
      lines.length > 0 ? lines.map(renderDiffLine) : [el('div', { className: 'diff-line diff-line-meta', textContent: 'No preview available' })]
    )
  ])
}

function renderDiffFileNav(files: FileDiff[]): HTMLElement {
  const nav = el('div', { className: 'diff-file-nav' })
  for (const file of files) {
    const row = el('button', { type: 'button', className: 'diff-file-nav-row' }, [
      el('span', { className: 'path', textContent: file.path }),
      el('span', { className: 'stats' }, [
        el('span', { className: 'diff-stat-add', textContent: `+${file.additions}` }),
        ' ',
        el('span', { className: 'diff-stat-del', textContent: `−${file.deletions}` })
      ])
    ])
    row.dataset.diffAnchorId = fileDiffAnchorId(file.path)
    nav.append(row)
  }
  return nav
}

function totalStats(files: FileDiff[]): string {
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const fileWord = files.length === 1 ? 'file' : 'files'
  return `+${additions} −${deletions} · ${files.length} ${fileWord}`
}

export function renderDiffScreen(session: Session, files: FileDiff[]): HTMLElement {
  const backButton = el('button', {
    type: 'button',
    id: 'diff-back-button',
    className: 'btn-ghost',
    textContent: '← Back to sessions'
  })

  const header = el('div', { id: 'diff-header' }, [
    backButton,
    el('div', { id: 'diff-header-info' }, [
      el('div', { id: 'diff-session-name', textContent: session.branch }),
      el('div', {
        id: 'diff-session-stats',
        textContent: files.length === 0 ? 'No changes yet' : totalStats(files)
      })
    ])
  ])

  const sidebar = el('aside', { id: 'diff-sidebar' }, [
    el('div', { className: 'section-label', textContent: 'Files' }),
    renderDiffFileNav(files)
  ])

  const filesContainer = el(
    'div',
    { id: 'diff-files' },
    files.length > 0
      ? files.map(renderDiffFile)
      : [el('div', { id: 'diff-empty', textContent: "This session hasn't changed anything yet." })]
  )

  const main = el('main', { id: 'diff-main' }, [header, filesContainer])

  return el('div', { id: 'diff-screen' }, [sidebar, main])
}

export function renderDiffLoading(): HTMLElement {
  return el('div', { id: 'diff-screen' }, [
    el('main', { id: 'diff-main' }, [el('div', { id: 'diff-empty', textContent: 'Loading diff…' })])
  ])
}

export function renderDiffLoadError(message: string): HTMLElement {
  const backButton = el('button', {
    type: 'button',
    id: 'diff-back-button',
    className: 'btn-ghost',
    textContent: '← Back to sessions'
  })
  return el('div', { id: 'diff-screen' }, [
    el('main', { id: 'diff-main' }, [
      el('div', { id: 'diff-header' }, [backButton]),
      el('div', { id: 'diff-empty', textContent: `Failed to load diff: ${message}` })
    ])
  ])
}

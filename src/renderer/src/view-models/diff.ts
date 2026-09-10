import type { FileDiff } from '../../../shared/ipc-contract'

/**
 * A FileDiff plus the renderer-only "has the user reviewed this file yet"
 * flag the diff mockup (04a) tracks. It is not part of the diff payload -
 * applyReviewed (view-models/review.ts) stamps it from the app's per-session
 * review state before the viewer renders, so it works identically in live and
 * mock mode.
 */
export type ReviewFileDiff = FileDiff & { reviewed?: boolean }

/** The folder portion of a path incl. trailing slash, or '' for a root-level file. */
export function fileFolder(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut + 1)
}

/** The final path segment, e.g. "src/main/engine.ts" -> "engine.ts". */
export function fileBasename(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

export interface FileTreeGroup {
  folder: string
  files: ReviewFileDiff[]
}

/** Groups the diff's files under their folder, preserving first-seen folder order and file order within each. */
export function groupFilesByFolder(files: ReviewFileDiff[]): FileTreeGroup[] {
  const byFolder = new Map<string, ReviewFileDiff[]>()
  for (const file of files) {
    const folder = fileFolder(file.path)
    const bucket = byFolder.get(folder)
    if (bucket) bucket.push(file)
    else byFolder.set(folder, [file])
  }
  return [...byFolder].map(([folder, folderFiles]) => ({ folder, files: folderFiles }))
}

export interface ReviewSummary {
  reviewed: number
  total: number
}

/** The "N / M reviewed" tally the file-tree header shows. */
export function summarizeReview(files: ReviewFileDiff[]): ReviewSummary {
  return { reviewed: files.filter((file) => file.reviewed).length, total: files.length }
}

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

/** One rendered diff line, carrying the old/new file line numbers the gutter shows. */
export interface DiffRow {
  kind: DiffLineKind
  /** The raw line, prefix (`+`/`-`/space) and all, as it should be shown. */
  text: string
  /** Line number in the old file - set for context and removed lines. */
  oldLine?: number
  /** Line number in the new file - set for context and added lines. */
  newLine?: number
}

export interface DiffHunk {
  /** The `@@ … @@` header line, kept verbatim for display. */
  header: string
  rows: DiffRow[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parses a file's diffText into hunks with per-line old/new line numbers, so
 * the viewer can render a line-number gutter and count "hunk N of M". Lines
 * before the first hunk (git's own file header) are ignored. A file with no
 * hunk header at all (a binary file, a pure rename) yields no hunks - the
 * caller falls back to extractDisplayLines for those.
 */
export function parseHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const text of diffText.split('\n')) {
    const headerMatch = HUNK_HEADER.exec(text)
    if (headerMatch) {
      oldLine = Number(headerMatch[1])
      newLine = Number(headerMatch[2])
      current = { header: text, rows: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue

    const kind = classifyDiffLine(text)
    if (kind === 'add') {
      current.rows.push({ kind, text, newLine })
      newLine += 1
    } else if (kind === 'del') {
      current.rows.push({ kind, text, oldLine })
      oldLine += 1
    } else if (kind === 'meta') {
      // "\ No newline at end of file" - belongs to no line, advances neither counter.
      current.rows.push({ kind, text })
    } else {
      current.rows.push({ kind, text, oldLine, newLine })
      oldLine += 1
      newLine += 1
    }
  }

  return hunks
}

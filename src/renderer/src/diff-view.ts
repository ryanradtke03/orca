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

export function fileDiffAnchorId(path: string): string {
  return `diff-file-${path}`
}

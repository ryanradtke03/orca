import type { FileDiff, FileDiffStatus } from '../../shared/ipc-contract'

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/

interface InProgressFile {
  aPath: string
  bPath: string
  lines: string[]
  added: boolean
  deleted: boolean
  renamed: boolean
}

function finalize(file: InProgressFile): FileDiff {
  let additions = 0
  let deletions = 0
  // Only lines inside a hunk (after its "@@" header) are real content -
  // counting from the first "@@" onward, rather than pattern-matching "+++"/
  // "---" prefixes, avoids miscounting a genuine added/removed line that
  // happens to start with one (e.g. a markdown "---" rule or "+++" marker).
  let inHunk = false
  for (const line of file.lines) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }

  const status: FileDiffStatus = file.deleted
    ? 'deleted'
    : file.added
      ? 'added'
      : file.renamed
        ? 'renamed'
        : 'modified'
  const path = file.deleted ? file.aPath : file.bPath

  return { path, status, additions, deletions, diffText: file.lines.join('\n') }
}

/**
 * Parses `git diff`'s unified-diff text output into one entry per file. Only
 * understands the per-file header lines this app's own `git diff` invocation
 * can produce (new/deleted/rename markers) - not every exotic form `diff`
 * can emit (e.g. mode-only changes, copies).
 */
export function parseUnifiedDiff(raw: string): FileDiff[] {
  if (!raw.trim()) return []

  const files: FileDiff[] = []
  let current: InProgressFile | null = null

  for (const line of raw.split('\n')) {
    const header = FILE_HEADER.exec(line)
    if (header) {
      if (current) files.push(finalize(current))
      current = { aPath: header[1], bPath: header[2], lines: [line], added: false, deleted: false, renamed: false }
      continue
    }
    if (!current) continue

    if (line.startsWith('new file mode')) current.added = true
    else if (line.startsWith('deleted file mode')) current.deleted = true
    else if (line.startsWith('rename from') || line.startsWith('rename to')) current.renamed = true

    current.lines.push(line)
  }
  if (current) files.push(finalize(current))

  return files
}

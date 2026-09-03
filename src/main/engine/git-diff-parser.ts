import type { FileDiff, FileDiffStatus } from '../../shared/ipc-contract'

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/
const OLD_PATH_LINE = /^--- a\/(.+)$/
const NEW_PATH_LINE = /^\+\+\+ b\/(.+)$/
const RENAME_FROM_LINE = /^rename from (.+)$/
const RENAME_TO_LINE = /^rename to (.+)$/

interface InProgressFile {
  // Fallback path source only: the "diff --git a/X b/Y" header line is
  // genuinely ambiguous when a path itself contains " b/" (git emits no
  // escaping there), so oldPath/newPath below - each their own single,
  // unambiguous line - take priority whenever present.
  fallbackAPath: string
  fallbackBPath: string
  oldPath: string | null
  newPath: string | null
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
  const path = file.deleted ? (file.oldPath ?? file.fallbackAPath) : (file.newPath ?? file.fallbackBPath)

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
      current = {
        fallbackAPath: header[1],
        fallbackBPath: header[2],
        oldPath: null,
        newPath: null,
        lines: [line],
        added: false,
        deleted: false,
        renamed: false
      }
      continue
    }
    if (!current) continue

    if (line.startsWith('new file mode')) current.added = true
    else if (line.startsWith('deleted file mode')) current.deleted = true

    const oldPathMatch = OLD_PATH_LINE.exec(line)
    if (oldPathMatch) current.oldPath = oldPathMatch[1]
    const newPathMatch = NEW_PATH_LINE.exec(line)
    if (newPathMatch) current.newPath = newPathMatch[1]

    const renameFromMatch = RENAME_FROM_LINE.exec(line)
    if (renameFromMatch) {
      current.renamed = true
      current.oldPath = renameFromMatch[1]
    }
    const renameToMatch = RENAME_TO_LINE.exec(line)
    if (renameToMatch) {
      current.renamed = true
      current.newPath = renameToMatch[1]
    }

    current.lines.push(line)
  }
  if (current) files.push(finalize(current))

  return files
}

import { describe, expect, it } from 'vitest'
import {
  classifyDiffLine,
  extractDisplayLines,
  fileBasename,
  fileFolder,
  groupFilesByFolder,
  parseHunks,
  type ReviewFileDiff,
  summarizeReview
} from './diff-view'

function makeFile(path: string, overrides: Partial<ReviewFileDiff> = {}): ReviewFileDiff {
  return { path, status: 'modified', additions: 1, deletions: 0, diffText: '', ...overrides }
}

describe('extractDisplayLines', () => {
  it('drops the diff --git/index/---/+++ header lines and keeps hunks', () => {
    const diffText = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcde 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n')

    expect(extractDisplayLines(diffText)).toEqual(['@@ -1 +1 @@', '-old', '+new'])
  })

  it('falls back to whatever remains after diff --git/index when there is no hunk (e.g. a binary file)', () => {
    const diffText = [
      'diff --git a/image.png b/image.png',
      'index 1234567..89abcde 100644',
      'Binary files a/image.png and b/image.png differ'
    ].join('\n')

    expect(extractDisplayLines(diffText)).toEqual(['Binary files a/image.png and b/image.png differ'])
  })

  it('keeps every hunk when a file has more than one', () => {
    const diffText = ['diff --git a/foo.ts b/foo.ts', '--- a/foo.ts', '+++ b/foo.ts', '@@ -1 +1 @@', '-a', '+b', '@@ -5 +5 @@', '-c', '+d'].join(
      '\n'
    )

    expect(extractDisplayLines(diffText)).toEqual(['@@ -1 +1 @@', '-a', '+b', '@@ -5 +5 @@', '-c', '+d'])
  })
})

describe('classifyDiffLine', () => {
  it('classifies a hunk header line', () => {
    expect(classifyDiffLine('@@ -1,3 +1,4 @@ export interface Foo')).toBe('hunk')
  })

  it('classifies an added line', () => {
    expect(classifyDiffLine('+new line')).toBe('add')
  })

  it('classifies a removed line', () => {
    expect(classifyDiffLine('-old line')).toBe('del')
  })

  it('classifies a "no newline at end of file" marker', () => {
    expect(classifyDiffLine('\\ No newline at end of file')).toBe('meta')
  })

  it('classifies a plain context line', () => {
    expect(classifyDiffLine(' context line')).toBe('context')
  })

  it('classifies an empty line as context', () => {
    expect(classifyDiffLine('')).toBe('context')
  })
})

describe('parseHunks', () => {
  it('numbers context, added, and removed lines from the hunk header', () => {
    const diffText = [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -12,4 +12,5 @@ export interface Foo',
      ' context',
      '-removed',
      '+added one',
      '+added two',
      ' trailing'
    ].join('\n')

    const hunks = parseHunks(diffText)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].header).toBe('@@ -12,4 +12,5 @@ export interface Foo')
    expect(hunks[0].rows).toEqual([
      { kind: 'context', text: ' context', oldLine: 12, newLine: 12 },
      { kind: 'del', text: '-removed', oldLine: 13 },
      { kind: 'add', text: '+added one', newLine: 13 },
      { kind: 'add', text: '+added two', newLine: 14 },
      { kind: 'context', text: ' trailing', oldLine: 14, newLine: 15 }
    ])
  })

  it('splits multiple hunks and restarts numbering at each header', () => {
    const diffText = ['@@ -1 +1 @@', '-a', '+b', '@@ -5,2 +5,2 @@', ' c', '+d'].join('\n')
    const hunks = parseHunks(diffText)
    expect(hunks.map((hunk) => hunk.header)).toEqual(['@@ -1 +1 @@', '@@ -5,2 +5,2 @@'])
    expect(hunks[1].rows).toEqual([
      { kind: 'context', text: ' c', oldLine: 5, newLine: 5 },
      { kind: 'add', text: '+d', newLine: 6 }
    ])
  })

  it('gives a "no newline" marker no line number and advances neither counter', () => {
    const diffText = ['@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b'].join('\n')
    const rows = parseHunks(diffText)[0].rows
    expect(rows[1]).toEqual({ kind: 'meta', text: '\\ No newline at end of file' })
    expect(rows[2]).toEqual({ kind: 'add', text: '+b', newLine: 1 })
  })

  it('returns no hunks for a diff without a hunk header (binary/rename)', () => {
    expect(parseHunks('Binary files a/x.png and b/x.png differ')).toEqual([])
  })
})

describe('fileFolder / fileBasename', () => {
  it('splits a nested path into folder and basename', () => {
    expect(fileFolder('src/main/engine.ts')).toBe('src/main/')
    expect(fileBasename('src/main/engine.ts')).toBe('engine.ts')
  })

  it('treats a root-level file as having no folder', () => {
    expect(fileFolder('README.md')).toBe('')
    expect(fileBasename('README.md')).toBe('README.md')
  })
})

describe('groupFilesByFolder', () => {
  it('groups files under their folder, preserving folder and file order', () => {
    const files = [
      makeFile('src/shared/ipc.ts'),
      makeFile('src/main/a.ts'),
      makeFile('src/main/b.ts'),
      makeFile('src/shared/types.ts')
    ]
    const groups = groupFilesByFolder(files)
    expect(groups.map((group) => group.folder)).toEqual(['src/shared/', 'src/main/'])
    expect(groups[0].files.map((file) => file.path)).toEqual(['src/shared/ipc.ts', 'src/shared/types.ts'])
    expect(groups[1].files.map((file) => file.path)).toEqual(['src/main/a.ts', 'src/main/b.ts'])
  })
})

describe('summarizeReview', () => {
  it('counts reviewed files against the total', () => {
    const files = [
      makeFile('a.ts', { reviewed: true }),
      makeFile('b.ts', { reviewed: false }),
      makeFile('c.ts', { reviewed: true }),
      makeFile('d.ts')
    ]
    expect(summarizeReview(files)).toEqual({ reviewed: 2, total: 4 })
  })

  it('reports nothing reviewed when the flag is absent (live mode)', () => {
    expect(summarizeReview([makeFile('a.ts'), makeFile('b.ts')])).toEqual({ reviewed: 0, total: 2 })
  })
})

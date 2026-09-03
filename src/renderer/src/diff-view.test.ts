import { describe, expect, it } from 'vitest'
import { classifyDiffLine, extractDisplayLines } from './diff-view'

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

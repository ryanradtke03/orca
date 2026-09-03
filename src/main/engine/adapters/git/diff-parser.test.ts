import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff-parser'

describe('parseUnifiedDiff', () => {
  it('returns an empty array for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('   \n')).toEqual([])
  })

  it('parses a single modified file, counting additions and deletions', () => {
    const raw = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcde 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' context line',
      '-old line',
      '+new line',
      '+another new line',
      ' context line'
    ].join('\n')

    const files = parseUnifiedDiff(raw)

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('foo.ts')
    expect(files[0].status).toBe('modified')
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(1)
    expect(files[0].diffText).toBe(raw)
  })

  it('marks a new file as added and uses the b-side path', () => {
    const raw = [
      'diff --git a/bar.ts b/bar.ts',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/bar.ts',
      '@@ -0,0 +1,2 @@',
      '+line1',
      '+line2'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.path).toBe('bar.ts')
    expect(file.status).toBe('added')
    expect(file.additions).toBe(2)
    expect(file.deletions).toBe(0)
  })

  it('marks a removed file as deleted and uses the a-side path', () => {
    const raw = [
      'diff --git a/baz.ts b/baz.ts',
      'deleted file mode 100644',
      'index 1234567..0000000',
      '--- a/baz.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line1',
      '-line2'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.path).toBe('baz.ts')
    expect(file.status).toBe('deleted')
    expect(file.additions).toBe(0)
    expect(file.deletions).toBe(2)
  })

  it('marks a renamed file as renamed', () => {
    const raw = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 100%',
      'rename from old-name.ts',
      'rename to new-name.ts'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.path).toBe('new-name.ts')
    expect(file.status).toBe('renamed')
    expect(file.additions).toBe(0)
    expect(file.deletions).toBe(0)
  })

  it('parses multiple files from one diff, preserving order', () => {
    const raw = [
      'diff --git a/one.ts b/one.ts',
      'index 1111111..2222222 100644',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/two.ts b/two.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/two.ts',
      '@@ -0,0 +1 @@',
      '+c'
    ].join('\n')

    const files = parseUnifiedDiff(raw)

    expect(files.map((f) => f.path)).toEqual(['one.ts', 'two.ts'])
    expect(files[0].status).toBe('modified')
    expect(files[1].status).toBe('added')
  })

  it('does not count the --- / +++ header lines as deletions/additions', () => {
    const raw = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcde 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.additions).toBe(1)
    expect(file.deletions).toBe(1)
  })

  it('counts a removed/added line whose content happens to be a "---"/"+++" rule, not just the file header', () => {
    const raw = [
      'diff --git a/README.md b/README.md',
      'index 1234567..89abcde 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1,3 +1,3 @@',
      ' title: hello',
      '----',
      '++++'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.additions).toBe(1)
    expect(file.deletions).toBe(1)
  })

  it('resolves the real path from --- / +++ lines rather than the ambiguous "diff --git" header for a filename containing " b/"', () => {
    // Git's "diff --git a/X b/Y" line has no escaping, so a path containing
    // the literal substring " b/" makes a naive a-path/b-path regex capture
    // the wrong thing. The --- / +++ lines are each a single, unambiguous
    // "prefix + rest-of-line" path instead.
    const raw = [
      'diff --git a/foo b/bar.ts b/foo b/bar.ts',
      'index 1234567..89abcde 100644',
      '--- a/foo b/bar.ts',
      '+++ b/foo b/bar.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.path).toBe('foo b/bar.ts')
  })

  it('resolves a rename purely from rename from/to lines when there are no --- / +++ lines', () => {
    const raw = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 100%',
      'rename from old-name.ts',
      'rename to new-name.ts'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.path).toBe('new-name.ts')
    expect(file.status).toBe('renamed')
  })

  it('handles a binary file diff without crashing and without counting line changes', () => {
    const raw = [
      'diff --git a/image.png b/image.png',
      'index 1234567..89abcde 100644',
      'Binary files a/image.png and b/image.png differ'
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)

    expect(file.path).toBe('image.png')
    expect(file.status).toBe('modified')
    expect(file.additions).toBe(0)
    expect(file.deletions).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { resolvePermissionResponses } from './prompt-options'

describe('resolvePermissionResponses', () => {
  it('resolves the plain Yes/No option numbers', () => {
    const text = ['Do you want to proceed?', '❯ 1. Yes', '  2. No'].join('\n')

    expect(resolvePermissionResponses(text)).toEqual({ approve: '1', deny: '2' })
  })

  it('resolves the "No" option even when it is not the second option', () => {
    const text = [
      'Bash command',
      '',
      '  npm install',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      "  2. Yes, and don't ask again for npm commands in this session",
      '  3. No, and tell Claude what to do differently'
    ].join('\n')

    expect(resolvePermissionResponses(text)).toEqual({ approve: '1', deny: '3' })
  })

  it('falls back to option 1 for approve and the last option for deny when labels are unrecognized', () => {
    const text = ['Do you want to proceed?', '❯ 1. Sure', '  2. Nope'].join('\n')

    expect(resolvePermissionResponses(text)).toEqual({ approve: '1', deny: '2' })
  })

  it('ignores numbered "Yes"/"No"-looking lines above the cursor, such as a shown diff', () => {
    const text = [
      '  2. Yes, that line looks right',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No'
    ].join('\n')

    expect(resolvePermissionResponses(text)).toEqual({ approve: '1', deny: '2' })
  })

  it('handles CRLF line endings without dropping the options', () => {
    const text = ['Do you want to proceed?', '❯ 1. Yes', '  2. No'].join('\r\n')

    expect(resolvePermissionResponses(text)).toEqual({ approve: '1', deny: '2' })
  })
})

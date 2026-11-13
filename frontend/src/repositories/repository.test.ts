import { describe, expect, it } from 'vitest'
import { fullName, parseFullName } from './repository.ts'

describe('fullName', () => {
  it('writes a repository as GitHub does', () => {
    expect(fullName({ owner: 'csillagu', name: 'tc-repo' })).toBe('csillagu/tc-repo')
  })
})

describe('parseFullName', () => {
  it('reads owner/name, leaving off the spaces around either part', () => {
    expect(parseFullName(' csillagu / tc-repo ')).toEqual({ owner: 'csillagu', name: 'tc-repo' })
  })

  it.each([[''], ['tc-repo'], ['/tc-repo'], ['csillagu/'], ['a/b/c'], [' / ']])(
    'reads nothing from %j',
    (text) => {
      expect(parseFullName(text)).toBeUndefined()
    },
  )
})
